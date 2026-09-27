import { config } from '../config.js';
import {
  generatedProblemSchema,
  generatedTestCasesSchema,
  type GeneratedProblem,
  type GeneratedTestCase,
} from '../domain/problem.js';
import type { Difficulty } from '../domain/types.js';
import { logger } from '../utils/logger.js';
import { compareOutput } from './evaluationService.js';
import { getExecutor } from './executor/index.js';
import { extractJson, problemSystemPrompt, testCaseSystemPrompt } from './aiPrompts.js';
import { pickBankProblem, type BankProblem } from './problemBank.js';

export interface GenerateOptions {
  difficulty: Difficulty;
  topics: string[];
  testCaseCount: number;
  publicTestCaseCount: number;
  /** Rotation offset so repeated offline generations vary. */
  offset?: number;
}

export interface GeneratedBundle {
  problem: GeneratedProblem;
  testCases: GeneratedTestCase[];
  source: 'anthropic' | 'offline' | 'openai-compat' | 'gemini';
  warnings: string[];
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
  };
}

async function generateWithModel(options: GenerateOptions): Promise<GeneratedBundle> {
  const warnings: string[] = [];
  let lastError = '';

  for (let attempt = 1; attempt <= config.ai.maxAttempts; attempt += 1) {
    try {
      const problemText = await callModel(problemSystemPrompt(options), 'Generate a C programming problem.', 2500);
      const problem = generatedProblemSchema.parse(extractJson(problemText));

      const testCaseText = await callModel(
        testCaseSystemPrompt(problem, options),
        'Generate the test cases as specified.',
        3000,
      );
      const parsedCases = generatedTestCasesSchema.parse(extractJson(testCaseText));

      if (parsedCases.test_cases.length < 2) {
        throw new Error('Fewer than two test cases were generated');
      }

      // The sample pair is authoritative: make sure it is present and public (plan §4.3).
      if (!parsedCases.test_cases.some((testCase) => testCase.is_public)) {
        parsedCases.test_cases[0]!.is_public = true;
        warnings.push('No public test case was returned; the first one was promoted to public.');
      }

      return { problem, testCases: parsedCases.test_cases, source: config.ai.provider === 'openai-compat' ? 'openai-compat' : 'anthropic', warnings };
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
export async function generateProblemBundle(options: GenerateOptions): Promise<GeneratedBundle> {
  if (!isAiConfigured()) {
    return bundleFromBank(pickBankProblem(options));
  }
  return generateWithModel(options);
}

export interface PerUserGenerationResult {
  bundle: GeneratedBundle;
  providerUsed: 'gemini' | 'server' | 'offline';
  geminiError: string | null;
}

/**
 * Per-user generation chain:
 *   1. the user's own Gemini key (when they saved one / chose gemini),
 *   2. the server's configured provider (openai-compat = the host Ollama/llama.cpp),
 *   3. the curated offline bank — the call never fails outright.
 * Every step reports why it was skipped so the UI can show an honest message.
 */
export async function generateProblemBundleForUser(
  options: GenerateOptions,
  userChoice: { aiProvider: 'server' | 'gemini'; geminiKey: string | null },
): Promise<PerUserGenerationResult> {
  const warnings: string[] = [];
  let geminiError: string | null = null;

  if (userChoice.aiProvider === 'gemini' && userChoice.geminiKey) {
    try {
      const { generateWithGemini } = await import('./geminiService.js');
      const { problem, testCases } = await generateWithGemini(userChoice.geminiKey, options);
      return {
        bundle: { problem, testCases, source: 'gemini', warnings },
        providerUsed: 'gemini',
        geminiError: null,
      };
    } catch (error) {
      geminiError = error instanceof Error ? error.message : String(error);
      warnings.push(`Gemini generation failed: ${geminiError}`);
      logger.warn({ err: geminiError }, 'per-user Gemini generation failed — falling back to the server provider');
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

  const outcome = await executor.execute({
    code: problem.reference_solution,
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
