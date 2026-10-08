import { config } from '../config.js';
import {
  generatedProblemSchema,
  generatedTestCasesSchema,
  generatedBundleSchema,
  type GeneratedProblem,
  type GeneratedTestCase,
} from '../domain/problem.js';
import type { Difficulty } from '../domain/types.js';
import { problemHelperFileSchema, type ProblemHelperFile } from '../domain/sourceFiles.js';
import { logger } from '../utils/logger.js';
import { z } from 'zod';
import { compareOutput } from './evaluationService.js';
import { getExecutor } from './executor/index.js';
import { extractJson, problemSystemPrompt, testCaseSystemPrompt } from './aiPrompts.js';
import { isQuotaError } from './aiQuota.js';
import { pickBankProblem, type BankProblem } from './problemBank.js';

export interface GenerateOptions {
  difficulty: Difficulty;
  topics: string[];
  testCaseCount: number;
  publicTestCaseCount: number;
  /** Rotation offset so repeated offline generations vary. */
  offset?: number;
  /** Learner intent, e.g. "focus on nested loops, avoid strings". */
  instructions?: string;
  /** Titles to avoid repeating within a quiz. */
  avoidTitles?: string[];
  excludeProblemIds?: number[];
}

export interface GeneratedBundle {
  problem: GeneratedProblem;
  testCases: GeneratedTestCase[];
  source: 'anthropic' | 'offline' | 'openai-compat' | 'gemini';
  warnings: string[];
  helperFiles: ProblemHelperFile[];
}

export interface VerificationOutcome {
  attempted: boolean;
  passed: boolean;
  detail: string;
  source: 'reference-solution' | 'sample-only' | 'skipped';
}

interface AnthropicLike {
  messages: {
    create(input: Record<string, unknown>): Promise<{ content: Array<{ type: string; text?: string }> }>;
  };
}

let anthropicClient: AnthropicLike | null = null;

export function isAiConfigured(): boolean {
  return (
    (config.ai.provider === 'anthropic' && config.ai.apiKey.length > 0) ||
    config.ai.provider === 'openai-compat'
  );
}

async function anthropic(): Promise<AnthropicLike> {
  if (!anthropicClient) {
    const { default: Anthropic } = (await import('@anthropic-ai/sdk')) as unknown as {
      default: new (options: { apiKey: string }) => AnthropicLike;
    };
    anthropicClient = new Anthropic({ apiKey: config.ai.apiKey });
  }
  return anthropicClient;
}

/**
 * OpenAI-compatible chat completion (used for self-hosted llama.cpp / llama-oid
 * servers). Only the minimal request/response shape this service needs is typed.
 */
async function callOpenAiCompatible(system: string, userMessage: string, maxTokens: number): Promise<string> {
  const response = await fetch(`${config.ai.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.ai.apiKey.length > 0 ? { Authorization: `Bearer ${config.ai.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: config.ai.model,
      max_tokens: maxTokens,
      temperature: 0.7,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userMessage },
      ],
    }),
    // A self-hosted llama.cpp server can be busy or wedged by another client's
    // request; without this the admin endpoint would hang instead of falling
    // back to the curated bank.
    signal: AbortSignal.timeout(config.ai.timeoutMs),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`AI endpoint returned ${response.status}: ${body.slice(0, 300)}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return (data.choices?.[0]?.message?.content ?? '').trim();
}

async function callModel(system: string, userMessage: string, maxTokens: number): Promise<string> {
  if (config.ai.provider === 'openai-compat') {
    return callOpenAiCompatible(system, userMessage, maxTokens);
  }
  const client = await anthropic();
  const response = await client.messages.create({
    model: config.ai.model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: userMessage }],
  });
  return response.content
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('\n')
    .trim();
}

/** Map a curated bank entry onto the AI response contract. */
function bundleFromBank(problem: BankProblem): GeneratedBundle {
  return {
    problem: {
      title: problem.title,
      description: problem.description,
      constraints: {
        time_limit_seconds: problem.timeLimitSeconds,
        memory_limit_mb: problem.memoryLimitMb,
        input_format: problem.inputFormat,
        output_format: problem.outputFormat,
        sample_input: problem.sampleInput,
        sample_output: problem.sampleOutput,
      },
      tags: problem.tags,
      difficulty: problem.difficulty,
      reference_solution: problem.referenceSolution,
    },
    testCases: problem.testCases.map((testCase) => ({
      input: testCase.input,
      expected_output: testCase.expectedOutput,
      is_public: testCase.isPublic,
      description: testCase.description,
    })),
    source: 'offline',
    warnings: ['Generated from the curated offline bank (AI_PROVIDER=offline).'],
    helperFiles: [],
  };
}

async function generateWithModel(options: GenerateOptions): Promise<GeneratedBundle> {
  const warnings: string[] = [];
  let lastError = '';

  for (let attempt = 1; attempt <= config.ai.maxAttempts; attempt += 1) {
    try {
      const problemText = await callModel(
        problemSystemPrompt(options),
        `Generate a C programming problem. Avoid these similar existing problems: ${JSON.stringify(await listExistingProblemTitles(options.excludeProblemIds ?? []))}`,
        4000,
      );
      const problem = generatedProblemSchema.parse(extractJson(problemText));

      let testCases: GeneratedTestCase[] | null = null;
      let helperFiles: ProblemHelperFile[] = [];
      for (const stage of ['test-cases', 'helper-files'] as const) {
        for (let stageAttempt = 1; stageAttempt <= 3; stageAttempt += 1) {
          try {
            if (stage === 'test-cases') {
              const caseText = await callModel(testCaseSystemPrompt(problem, options), 'Generate the test cases as specified.', 3000);
              testCases = generatedTestCasesSchema.parse(extractJson(caseText)).test_cases;
              const minimumRequired = Math.max(6, options.publicTestCaseCount + 4);
              if (testCases.length < minimumRequired) throw new Error(`Expected at least ${minimumRequired} cases, got ${testCases.length}`);
              if (!testCases.some((testCase) => testCase.is_public)) {
                testCases[0]!.is_public = true;
                warnings.push('No public test case was returned; the first one was promoted to public.');
              }
              break;
            }
            const helperText = await callModel(
              'Decide if reusable C helpers would materially help a student. Usually return no files. If useful, return strict JSON with helper_files array of {filename,content,language,purpose,autoInclude}. Avoid main(), use unique names, and make helpers compile cleanly with the entry source.',
              JSON.stringify({ title: problem.title, description: problem.description, topics: options.topics }),
              1200,
            );
            const parsedHelpers = z.object({ helper_files: z.array(problemHelperFileSchema).max(5).default([]) }).parse(extractJson(helperText));
            helperFiles = parsedHelpers.helper_files;
            break;
          } catch (error) {
            if (stageAttempt === 3) throw error;
            const delay = Math.min(1_000 * 2 ** (stageAttempt - 1), 4_000);
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }
      }

      const validation = await validateBundle(problem, testCases ?? []);
      if (!validation.passed) {
        const correctedText = await callModel(
          'You are a careful C problem auditor. Correct the provided problem and test cases only when necessary. Ensure the reference implementation compiles, every expected result is correct, the requested examples/specification/constraints agree, and the requested topic/difficulty fit. Return the full corrected JSON bundle.',
          JSON.stringify({ problem, test_cases: testCases, issues: validation.detail }),
          4500,
        );
        const corrected = generatedBundleSchema.parse(extractJson(correctedText));
        return {
          problem: { ...corrected, reference_solution: corrected.reference_solution },
          testCases: corrected.test_cases,
          source: config.ai.provider === 'openai-compat' ? 'openai-compat' : 'anthropic',
          warnings,
          helperFiles: corrected.helper_files,
        };
      }
      return {
        problem,
        testCases: testCases ?? [],
        source: config.ai.provider === 'openai-compat' ? 'openai-compat' : 'anthropic',
        warnings,
        helperFiles,
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      logger.warn({ attempt, maxAttempts: config.ai.maxAttempts, err: lastError }, 'AI generation attempt failed');
    }
  }

  warnings.push(`Fell back to the offline bank after ${config.ai.maxAttempts} failed AI attempts: ${lastError}`);
  return { ...bundleFromBank(pickBankProblem(options)), warnings };
}

/**
 * Generate a problem plus its test cases. Falls back to the curated bank when the
 * provider is offline or the model keeps returning unusable JSON, so callers always
 * receive a usable bundle.
 */
async function listExistingProblemTitles(excludeIds: number[]): Promise<string[]> {
  const { listPublicProblemSets } = await import('../db/repositories.js');
  const excluded = new Set(excludeIds);
  const sets = await listPublicProblemSets({ limit: 200 });
  return sets.filter((set) => !excluded.has(set.id)).map((set) => set.title);
}

async function validateBundle(problem: GeneratedProblem, testCases: GeneratedTestCase[]): Promise<VerificationOutcome> {
  if (!problem.reference_solution) return { attempted: false, passed: false, detail: 'No reference solution was returned.', source: 'sample-only' };
  const structural = [
    ['Examples', /##?\s*Examples?/i.test(problem.description)],
    ['Notes', /##?\s*(Notes|Hints?)/i.test(problem.description)],
    ['input format', problem.constraints.input_format.trim().length > 12],
    ['output format', problem.constraints.output_format.trim().length > 12],
    ['two public examples', testCases.filter((item) => item.is_public).length >= 2],
    ['four hidden cases', testCases.filter((item) => !item.is_public).length >= 4],
  ].filter(([, valid]) => !valid).map(([name]) => name);
  const execution = await verifyTestCases(problem, testCases);
  return structural.length
    ? { ...execution, passed: false, detail: `${execution.detail} Missing/inadequate: ${structural.join(', ')}.` }
    : execution;
}

export async function generateProblemBundle(options: GenerateOptions): Promise<GeneratedBundle> {
  if (!isAiConfigured()) {
    return bundleFromBank(pickBankProblem(options));
  }
  return generateWithModel(options);
}

/** Human-readable Gemini failure that names the free-tier limit when quota caused it. */
function describeGeminiFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return isQuotaError(error)
    ? `Gemini generation failed (free-tier limit, about 20k tokens/min): ${message} Wait a minute, generate fewer problems at once, or use the server provider.`
    : `Gemini generation failed: ${message}`;
}

export interface PerUserGenerationResult {
  bundle: GeneratedBundle;
  providerUsed: 'gemini' | 'server' | 'offline';
  geminiError: string | null;
}

/**
 * Per-user generation chain:
 *   1. the user's own Gemini key (when they saved one / chose gemini) — compact
 *      single-call mode first for token efficiency, two-call escalation on failure,
 *   2. the server's configured provider (openai-compat = the host Ollama/llama.cpp),
 *   3. the curated offline bank — the call never fails outright.
 * Every step reports why it was skipped so the UI can show an honest message.
 */
export async function generateProblemBundleForUser(
  options: GenerateOptions,
  userChoice: { aiProvider: 'server' | 'gemini'; geminiKey: string | null; geminiModel?: string; compact?: boolean },
): Promise<PerUserGenerationResult> {
  const warnings: string[] = [];
  let geminiError: string | null = null;

  if (userChoice.aiProvider === 'gemini' && userChoice.geminiKey) {
    const { generateWithGemini, generateWithGeminiCompact } = await import('./geminiService.js');
    try {
      const first = userChoice.compact === false
        ? await generateWithGemini(userChoice.geminiKey, options, userChoice.geminiModel)
        : await generateWithGeminiCompact(userChoice.geminiKey, options, userChoice.geminiModel);
      warnings.push(...first.warnings);
      return {
        bundle: { problem: first.problem, testCases: first.testCases, source: 'gemini', warnings, helperFiles: first.helperFiles },
        providerUsed: 'gemini',
        geminiError: null,
      };
    } catch (error) {
      const firstError = error instanceof Error ? error.message : String(error);
      // A quota failure must NOT escalate to the two-call flow — that spends
      // more tokens right after the budget ran out. Skip straight to fallback.
      if (isQuotaError(error)) {
        geminiError = describeGeminiFailure(error);
        warnings.push(geminiError);
        logger.warn({ err: geminiError }, 'per-user Gemini quota reached — falling back without escalation');
      } else {
        logger.warn({ err: firstError }, 'compact Gemini generation failed — retrying with the two-call flow');
        try {
          // Escalate once to the higher-quality two-call flow before leaving Gemini.
          // (Only when compact mode was requested; two-call already failed if not.)
          if (userChoice.compact === false) throw error;
          const escalated = await generateWithGemini(userChoice.geminiKey, options, userChoice.geminiModel);
          warnings.push(`Compact generation failed (${firstError}); used the detailed two-call flow instead.`, ...escalated.warnings);
          return {
            bundle: { problem: escalated.problem, testCases: escalated.testCases, source: 'gemini', warnings, helperFiles: escalated.helperFiles },
            providerUsed: 'gemini',
            geminiError: null,
          };
        } catch (secondError) {
          geminiError = describeGeminiFailure(secondError);
          warnings.push(geminiError);
          logger.warn({ err: geminiError }, 'per-user Gemini generation failed — falling back to the server provider');
        }
      }
    }
  } else if (userChoice.aiProvider === 'gemini') {
    geminiError = 'A Gemini key was selected but is no longer stored.';
    warnings.push(geminiError);
  }

  if (isAiConfigured()) {
    const bundle = await generateWithModel(options);
    if (bundle.source !== 'offline') {
      return { bundle, providerUsed: 'server', geminiError };
    }
    warnings.push(...bundle.warnings);
    return { bundle, providerUsed: 'offline', geminiError };
  }

  const fallback = bundleFromBank(pickBankProblem(options));
  warnings.push('No server AI provider is configured; served from the curated offline bank.');
  return { bundle: { ...fallback, warnings }, providerUsed: 'offline', geminiError };
}

/**
 * Verify expectations by compiling and running a reference solution against every
 * generated test case. This is the safeguard against shipping a problem whose
 * "expected" output is impossible to produce.
 */
export async function verifyTestCases(
  problem: GeneratedProblem,
  testCases: GeneratedTestCase[],
  helperFiles: ProblemHelperFile[] = [],
): Promise<VerificationOutcome> {
  if (!problem.reference_solution) {
    return {
      attempted: false,
      passed: false,
      detail: 'No reference solution was provided, so expectations could not be verified.',
      source: 'sample-only',
    };
  }

  let executor;
  try {
    executor = (await getExecutor()).executor;
  } catch (error) {
    return {
      attempted: false,
      passed: false,
      detail: `Sandbox unavailable: ${error instanceof Error ? error.message : String(error)}`,
      source: 'skipped',
    };
  }

  const helperSources = helperFiles;
  const outcome = await executor.execute({
    code: problem.reference_solution,
    ...(helperSources.length ? {
      files: [
        { filename: 'solution.c', content: problem.reference_solution, autoInclude: true },
        ...helperSources.map((file) => ({ filename: file.filename, content: file.content, autoInclude: file.autoInclude })),
      ],
      entryFile: 'solution.c',
    } : {}),
    testCases: testCases.map((testCase, index) => ({
      id: index,
      inputData: testCase.input,
      expectedOutput: testCase.expected_output,
    })),
    limits: {
      timeLimitMs: Math.max(problem.constraints.time_limit_seconds * 1000, 1000),
      memoryLimitMb: problem.constraints.memory_limit_mb,
      pidsLimit: config.executor.pidsLimit,
      maxOutputBytes: config.executor.maxOutputBytes,
    },
  });

  if (!outcome.compiled) {
    return {
      attempted: true,
      passed: false,
      detail: `Reference solution did not compile: ${outcome.compilationError ?? 'unknown error'}`,
      source: 'reference-solution',
    };
  }

  const failures = outcome.runs
    .map((run, index) => ({ run, testCase: testCases[index] }))
    .filter((entry) => !entry.run.passed)
    .map((entry) => {
      const comparison = compareOutput(entry.testCase?.expected_output ?? '', entry.run.actualOutput);
      return `case #${entry.run.testCaseId} (${entry.testCase?.description ?? ''}): expected ${JSON.stringify(
        comparison.normalizedExpected,
      )}, reference produced ${JSON.stringify(comparison.normalizedActual)} [${entry.run.errorType}]`;
    });

  if (failures.length > 0) {
    return {
      attempted: true,
      passed: false,
      detail: `${failures.length}/${testCases.length} expectations disagree with the reference solution: ${failures.join('; ')}`,
      source: 'reference-solution',
    };
  }

  return {
    attempted: true,
    passed: true,
    detail: `Reference solution passes all ${testCases.length} test cases.`,
    source: 'reference-solution',
  };
}
