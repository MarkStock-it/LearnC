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
  source: 'anthropic' | 'offline' | 'openai-compat';
  warnings: string[];
}

export interface VerificationOutcome {
  attempted: boolean;
  passed: boolean;
  detail: string;
  source: 'reference-solution' | 'sample-only' | 'skipped';
}

/** System prompt from plan §4.1. */
function problemSystemPrompt(options: GenerateOptions): string {
  return `You are an expert C programming instructor designing exam-style coding challenges for second-year Computer Science students at a Philippine university. Your goal is to generate rigorous, well-scoped problems that test fundamental C concepts (arrays, strings, pointers, loops, functions, file I/O).

CONSTRAINTS:
- Problem difficulty: ${options.difficulty}
- Topics: ${options.topics.join(', ')}
- Memory limit: 256 MB
- Standard: C99, compiled with gcc -Wall -Wextra -std=c99
- Keep the statement solvable within a 2-hour exam block.

OUTPUT FORMAT:
Respond ONLY with a valid JSON object (no markdown, no preamble) with this exact structure:
{
  "title": "string (e.g., 'Prime Number Checker')",
  "description": "string (detailed problem statement in markdown, including input, output and an example)",
  "constraints": {
    "time_limit_seconds": number,
    "memory_limit_mb": 256,
    "input_format": "string describing the exact input format",
    "output_format": "string describing the exact output format",
    "sample_input": "string (exact sample stdin, including trailing newline)",
    "sample_output": "string (exact expected stdout, including trailing newline)"
  },
  "tags": ["1 to 6 short topic tags"],
  "difficulty": "${options.difficulty}",
  "reference_solution": "string (a complete, correct C99 solution that reads stdin and writes stdout)"
}

VALIDATION CHECKLIST:
- Sample input/output must be a valid C program's input/output pair
- The problem must have one unambiguous solution
- Specify exactly when a newline is printed and whether integers are space separated
- Prefer integer arithmetic; if you use floating point, fix the printed precision
- The reference_solution must compile with -Wall -Wextra -std=c99 and produce the sample output`;
}

/** System prompt from plan §4.2. */
function testCaseSystemPrompt(problem: GeneratedProblem, options: GenerateOptions): string {
  const hidden = Math.max(options.testCaseCount - options.publicTestCaseCount, 1);
  return `You are generating comprehensive test cases for a C programming problem.

PROBLEM TITLE: ${problem.title}

PROBLEM DESCRIPTION:
${problem.description}

CONSTRAINTS:
- Time limit: ${problem.constraints.time_limit_seconds} seconds
- Memory limit: ${problem.constraints.memory_limit_mb} MB
- Input format: ${problem.constraints.input_format}
- Output format: ${problem.constraints.output_format}
- Sample input: ${JSON.stringify(problem.constraints.sample_input)}
- Sample output: ${JSON.stringify(problem.constraints.sample_output)}

GENERATE ${options.publicTestCaseCount} PUBLIC test cases (simple, visible to students) and ${hidden} HIDDEN test cases (edge cases, boundary conditions, stress tests).

OUTPUT FORMAT:
Respond ONLY with valid JSON:
{
  "test_cases": [
    {
      "input": "string (exact stdin, including trailing newline)",
      "expected_output": "string (exact stdout, including trailing newline)",
      "is_public": boolean,
      "description": "string (e.g. 'Boundary: n=1')"
    }
  ]
}

TEST CASE PRINCIPLES:
- Include at least one boundary case (minimum or maximum input size)
- Include at least one edge case (empty input, single element, negative numbers)
- Include at least one larger case that would expose an inefficient solution
- Every expected_output must be deterministic and exactly reproducible
- No floating point unless the precision is stated; prefer integers
- State exactly whether the output ends with a newline`;
}

function extractJson(text: string): unknown {
  const withoutFences = text
    .replace(/^\s*```(?:json)?/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  const start = withoutFences.indexOf('{');
  const end = withoutFences.lastIndexOf('}');
  const candidate = start >= 0 && end > start ? withoutFences.slice(start, end + 1) : withoutFences;
  return JSON.parse(candidate);
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
