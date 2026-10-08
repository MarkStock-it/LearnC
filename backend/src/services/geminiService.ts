import { config } from '../config.js';
import {
  generatedProblemSchema,
  generatedTestCasesSchema,
  type GeneratedProblem,
  type GeneratedTestCase,
} from '../domain/problem.js';
import type { GenerateOptions } from './aiService.js';
import { problemHelperFileSchema, type ProblemHelperFile } from '../domain/sourceFiles.js';
import { z } from 'zod';
import { condenseProblemForTestCases, learnerIntentBlock, problemSystemPrompt, testCaseSystemPrompt } from './aiPrompts.js';
import {
  estimateTokens,
  GeminiQuotaError,
  noteGeminiRetryAfter,
  parseRetryAfterMs,
  reconcileGeminiUsage,
  reserveGeminiBudget,
  type BudgetReservation,
} from './aiQuota.js';

/**
 * Gemini client (Generative Language REST API, generateContent).
 *
 * Token-efficiency decisions (students bring their own key — free tier is
 * ~10-15 requests/min, so every token counts):
 * - `responseMimeType: application/json` + `responseSchema` — the API enforces
 *   the shape, so no "respond ONLY with valid JSON" pleading and no retry churn
 *   on malformed output.
 * - thinking disabled when the model supports a budget — a structured problem
 *   write-up does not need hidden reasoning tokens, which can dwarf the answer.
 * - default model is flash-lite-class (cheap + fast); a student's model choice
 *   (AI_MODEL env or per-request override) wins.
 * - `compact` mode merges problem + test cases into ONE call with tight output
 *   caps (default path), roughly halving cost vs. the two-call flow.
 */

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

/** Models where hidden thinking can be switched off via a budget of 0. */
const GEMINI_25_MODELS = /^gemini-2\.5(?:-|$)/i;
const GEMINI_3_MODELS = /^gemini-3\./i;
const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';
const SUPPORTED_GEMINI_MODELS = new Set([
  'gemini-3.8-flash',
  'gemini-3.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
]);

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
  error?: { message?: string };
}

function effectiveModel(override?: string): string {
  const configured = config.ai.model.trim();
  const chosen = override?.trim() || (SUPPORTED_GEMINI_MODELS.has(configured) ? configured : DEFAULT_GEMINI_MODEL);
  return chosen.length > 0 ? chosen : DEFAULT_GEMINI_MODEL;
}

async function callGemini(options: {
  apiKey: string;
  model?: string;
  system: string;
  userMessage: string;
  maxTokens: number;
  responseSchema?: Record<string, unknown>;
  temperature?: number;
  /**
   * When true, reserve `prompt estimate + maxTokens` against the key's
   * per-minute budget first, and reconcile with the real usage afterwards.
   */
  budget?: boolean;
}): Promise<string> {
  const model = effectiveModel(options.model);
  let reservation: BudgetReservation | null = null;
  let estimatedTotal = 0;
  if (options.budget) {
    estimatedTotal =
      estimateTokens(options.system) + estimateTokens(options.userMessage) + options.maxTokens;
    reservation = await reserveGeminiBudget(options.apiKey, estimatedTotal);
    if (!reservation) {
      throw new GeminiQuotaError(
        'Your free Gemini key allows roughly 20k tokens per minute, and this request would exceed the budget left. ' +
          'Wait a minute, generate fewer problems at once, or switch to the server provider.',
      );
    }
  }
  const generationConfig: Record<string, unknown> = {
    maxOutputTokens: options.maxTokens,
  };
  // Gemini 3.6+ ignores custom sampling values; Gemini 3 is tuned for temperature 1.
  if (!GEMINI_3_MODELS.test(model)) generationConfig.temperature = options.temperature ?? 0.7;
  if (options.responseSchema) {
    generationConfig.responseMimeType = 'application/json';
    generationConfig.responseSchema = options.responseSchema;
  }
  if (GEMINI_3_MODELS.test(model)) {
    // Gemini 3 accepts thinkingLevel; 2.5's thinkingBudget is not valid here.
    generationConfig.thinkingConfig = { thinkingLevel: 'low' };
  } else if (GEMINI_25_MODELS.test(model) && !/flash-lite/i.test(model)) {
    // Flash supports disabling thoughts with a 0 budget; unlike Pro it does not require 128+.
    generationConfig.thinkingConfig = { thinkingBudget: 0 };
  }

  const response = await fetch(`${BASE_URL}/models/${model}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': options.apiKey,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: options.system }] },
      contents: [{ role: 'user', parts: [{ text: options.userMessage }] }],
      generationConfig,
    }),
    signal: AbortSignal.timeout(config.ai.timeoutMs),
  });

  const data = (await response.json().catch(() => ({}))) as GeminiResponse;
  if (reservation) {
    const actual = data.usageMetadata?.totalTokenCount;
    if (typeof actual === 'number' && actual >= 0) {
      reconcileGeminiUsage(reservation.fingerprint, estimatedTotal, actual);
    }
    // On error responses the spend is unknown, so the estimate stays deducted:
    // conservative, and it stops a failing key from hammering the API.
  }
  if (!response.ok) {
    const details = data.error?.message?.slice(0, 260) ?? 'unknown error';
    if (response.status === 401 || (response.status === 403 && /api.?key|credential|permission/i.test(details))) {
      throw new Error(`Gemini API rejected this API key (HTTP ${response.status}): ${details}. Re-enter a valid Gemini API key with Gemini API access enabled.`);
    }
    if (response.status === 400 || response.status === 403 || response.status === 404) {
      throw new Error(`Gemini API rejected model ${model} (HTTP ${response.status}): ${details}. Check the model name and whether your key/project has access; Gemini 2.5 access is restricted for some accounts.`);
    }
    if (response.status === 429) {
      const retryAfterMs = parseRetryAfterMs(data, response.headers);
      if (reservation) noteGeminiRetryAfter(reservation.fingerprint, retryAfterMs);
      const waitHint =
        retryAfterMs > 0
          ? `The API asked for a ~${Math.ceil(retryAfterMs / 1000)}s backoff.`
          : 'Wait a minute before retrying.';
      throw new GeminiQuotaError(
        `Gemini API rate limit/quota reached (HTTP 429): ${details}. ${waitHint} Generate fewer problems at once or choose the server provider.`,
        retryAfterMs,
      );
    }
    throw new Error(`Gemini API returned ${response.status}: ${details}`);
  }

  const text = (data.candidates?.[0]?.content?.parts ?? [])
    .map((part) => part.text ?? '')
    .join('')
    .trim();

  if (text.length === 0) {
    throw new Error('Gemini returned an empty response (the safety filters may have blocked it)');
  }
  return text;
}

/** Minimal JSON-schema subset Gemini's responseSchema accepts (OpenAPI style). */
const problemResponseSchema: Record<string, unknown> = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    description: { type: 'string' },
    constraints: {
      type: 'object',
      properties: {
        time_limit_seconds: { type: 'integer' },
        memory_limit_mb: { type: 'integer' },
        input_format: { type: 'string' },
        output_format: { type: 'string' },
        sample_input: { type: 'string' },
        sample_output: { type: 'string' },
      },
      required: ['time_limit_seconds', 'memory_limit_mb', 'input_format', 'output_format', 'sample_input', 'sample_output'],
    },
    tags: { type: 'array', items: { type: 'string' } },
    difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'] },
    reference_solution: { type: 'string' },
  },
  required: ['title', 'description', 'constraints', 'tags', 'difficulty', 'reference_solution'],
};

const testCasesResponseSchema: Record<string, unknown> = {
  type: 'object',
  properties: {
    test_cases: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          input: { type: 'string' },
          expected_output: { type: 'string' },
          is_public: { type: 'boolean' },
          description: { type: 'string' },
        },
        required: ['input', 'expected_output', 'is_public', 'description'],
      },
    },
  },
  required: ['test_cases'],
};

function parseProblem(text: string): GeneratedProblem {
  // With responseSchema the body is pure JSON; the slice keeps legacy models safe.
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return generatedProblemSchema.parse(JSON.parse(start >= 0 && end > start ? text.slice(start, end + 1) : text));
}

function parseTestCases(text: string): Array<GeneratedTestCase> {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return generatedTestCasesSchema.parse(JSON.parse(start >= 0 && end > start ? text.slice(start, end + 1) : text)).test_cases;
}

function finalizeCases(testCases: Array<GeneratedTestCase>): Array<GeneratedTestCase> {
  if (testCases.length < 2) throw new Error('Fewer than two test cases were generated');
  if (!testCases.some((testCase) => testCase.is_public)) {
    testCases[0]!.is_public = true;
  }
  return testCases;
}

/**
 * Two-call flow (highest quality): §4.1 problem prompt, then §4.2 test cases.
 */
export async function generateWithGemini(
  apiKey: string,
  options: GenerateOptions,
  model?: string,
): Promise<{ problem: GeneratedProblem; testCases: Array<GeneratedTestCase>; helperFiles: ProblemHelperFile[]; warnings: string[] }> {
  const problemText = await callGemini({
    apiKey,
    model,
    system: problemSystemPrompt(options),
    userMessage: 'Generate a C programming problem.',
    maxTokens: 2048,
    responseSchema: problemResponseSchema,
    budget: true,
  });
  const problem = parseProblem(problemText);

  // The test-case call needs formats, samples and semantics — not the full
  // statement prose, which can be the largest input chunk of the three calls.
  const testCaseText = await callGemini({
    apiKey,
    model,
    system: testCaseSystemPrompt(condenseProblemForTestCases(problem), options),
    userMessage: 'Generate the test cases as specified.',
    maxTokens: 2048,
    responseSchema: testCasesResponseSchema,
    budget: true,
  });

  const testCases = finalizeCases(parseTestCases(testCaseText));
  const helperFiles = await generateHelperFiles(apiKey, options, model, problem);
  return { problem, testCases, helperFiles, warnings: [] };
}

async function generateHelperFiles(
  apiKey: string,
  options: GenerateOptions,
  model: string | undefined,
  problem: GeneratedProblem,
): Promise<ProblemHelperFile[]> {
  const raw = await callGemini({
    apiKey,
    model,
    system: 'Determine if a small reusable C utility would materially help with this problem. Return an empty helper_files array unless genuinely useful. Never include main(). Any helper must compile with the provided entry point and be useful in context. Return strict JSON only.',
    userMessage: JSON.stringify({ problem, topics: options.topics }),
    maxTokens: 1200,
    budget: true,
    responseSchema: {
      type: 'object',
      properties: { helper_files: { type: 'array', maxItems: 3, items: { type: 'object', properties: {
        filename: { type: 'string' }, content: { type: 'string' }, language: { type: 'string', enum: ['c', 'h'] },
        purpose: { type: 'string' }, autoInclude: { type: 'boolean' },
      }, required: ['filename', 'content', 'language', 'purpose', 'autoInclude'] } } },
      required: ['helper_files'],
    },
  });
  const parsed = JSON.parse(raw) as { helper_files?: unknown };
  return z.array(problemHelperFileSchema).max(3).parse(parsed.helper_files ?? []);
}

/**
 * One-call compact flow (default): the problem and its test cases arrive in a
 * single response with tight caps. Test cases are capped at 10 (with a
 * warning when the request asked for more — 24 cases in one response would
 * both blow the output budget and risk truncation), helper files are not
 * requested here (they cost output tokens on every problem; the two-call
 * flow still produces them), and `maxTokens` scales with the case count
 * instead of always spending the ceiling.
 */
const MAX_COMPACT_CASES = 10;

export async function generateWithGeminiCompact(
  apiKey: string,
  options: GenerateOptions,
  model?: string,
): Promise<{ problem: GeneratedProblem; testCases: Array<GeneratedTestCase>; helperFiles: ProblemHelperFile[]; warnings: string[] }> {
  const warnings: string[] = [];
  const requested = Math.max(options.testCaseCount, options.publicTestCaseCount + 4);
  const caseTarget = Math.min(MAX_COMPACT_CASES, Math.max(6, requested));
  if (requested > MAX_COMPACT_CASES) {
    warnings.push(
      `Asked for ${requested} test cases; generated ${caseTarget} to stay inside the free Gemini token budget.`,
    );
  }
  // Roughly 1500 tokens for the write-up + reference solution, ~140 per case.
  const maxTokens = Math.min(3072, 1500 + caseTarget * 140);

  const system = `You create exam-style C99 problems for CS students. Output strict JSON only — no prose, no markdown fences. Write a concise title and a compact statement (Overview, Input, Output, Constraints, exactly two worked examples with one-line explanations, brief Notes). Keep every example consistent with the reference solution. Calibrate to ${options.difficulty} difficulty. Do not include helper files.`;

  const userMessage = `Create ONE problem that genuinely requires: ${options.topics.join(', ')}.
Difficulty target: ${options.difficulty}
time limit seconds: 2
memory limit MB: 256
test cases: exactly ${caseTarget} — at least two public examples and the rest hidden edge/boundary cases. Each expected_output must agree with the reference solution.${learnerIntentBlock(options)}
JSON shape: {"title": string, "description": string, "constraints": {"time_limit_seconds": number, "memory_limit_mb": number, "input_format": string, "output_format": string, "sample_input": string, "sample_output": string}, "tags": string[2..3], "difficulty": "${options.difficulty}", "reference_solution": string, "test_cases": [{"input": string, "expected_output": string, "is_public": boolean, "description": string}]}`;

  const casesSchema = (testCasesResponseSchema.properties as Record<string, Record<string, unknown>>).test_cases;

  const text = await callGemini({
    apiKey,
    model,
    system,
    userMessage,
    maxTokens,
    temperature: 0.6,
    budget: true,
    responseSchema: {
      type: 'object',
      properties: {
        ...(problemResponseSchema.properties as Record<string, unknown>),
        test_cases: { ...casesSchema, maxItems: caseTarget },
      },
      required: [...(problemResponseSchema.required as string[]), 'test_cases'],
    },
  });

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  const parsed = JSON.parse(start >= 0 && end > start ? text.slice(start, end + 1) : text) as {
    title: string;
    description: string;
    constraints: GeneratedProblem['constraints'];
    tags: string[];
    difficulty: string;
    reference_solution: string;
    test_cases?: Array<GeneratedTestCase>;
    helper_files?: unknown;
  };

  const problem = generatedProblemSchema.parse({
    title: parsed.title,
    description: parsed.description,
    constraints: parsed.constraints,
    tags: parsed.tags,
    difficulty: parsed.difficulty,
    reference_solution: parsed.reference_solution,
  });

  // Test cases come from the same response; if the model omitted them (or the
  // schema trimmed them), fall back to the sample pair so the bundle is usable.
  const testCases = parsed.test_cases && parsed.test_cases.length >= 2
    ? finalizeCases(parsed.test_cases)
    : finalizeCases([
        {
          input: problem.constraints.sample_input,
          expected_output: problem.constraints.sample_output,
          is_public: true,
          description: 'Sample pair',
        },
        {
          input: problem.constraints.sample_input,
          expected_output: problem.constraints.sample_output,
          is_public: false,
          description: 'Hidden duplicate (model omitted test cases)',
        },
      ]);

  return { problem, testCases, helperFiles: [], warnings };
}
