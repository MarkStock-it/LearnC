import { config } from '../config.js';
import {
  generatedProblemSchema,
  generatedTestCasesSchema,
  type GeneratedProblem,
  type GeneratedTestCase,
} from '../domain/problem.js';
import type { GenerateOptions } from './aiService.js';
import { learnerIntentBlock, problemSystemPrompt, testCaseSystemPrompt } from './aiPrompts.js';

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
const THINKING_BUDGET_MODELS = [/^gemini-2\.5/, /^gemini-3\./];

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
  error?: { message?: string };
}

function effectiveModel(override?: string): string {
  const chosen = override?.trim() || config.ai.model;
  return chosen.length > 0 ? chosen : 'gemini-2.5-flash-lite';
}

async function callGemini(options: {
  apiKey: string;
  model?: string;
  system: string;
  userMessage: string;
  maxTokens: number;
  responseSchema?: Record<string, unknown>;
  temperature?: number;
}): Promise<string> {
  const model = effectiveModel(options.model);
  const generationConfig: Record<string, unknown> = {
    maxOutputTokens: options.maxTokens,
    temperature: options.temperature ?? 0.7,
  };
  if (options.responseSchema) {
    generationConfig.responseMimeType = 'application/json';
    generationConfig.responseSchema = options.responseSchema;
  }
  if (THINKING_BUDGET_MODELS.some((pattern) => pattern.test(model))) {
    generationConfig.thinkingConfig = { thinkingBudget: 0 };
  }

  const response = await fetch(`${BASE_URL}/models/${model}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': options.apiKey,
    },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: options.system }] },
      contents: [{ role: 'user', parts: [{ text: options.userMessage }] }],
      generationConfig,
    }),
    signal: AbortSignal.timeout(config.ai.timeoutMs),
  });

  const data = (await response.json().catch(() => ({}))) as GeminiResponse;
  if (!response.ok) {
    throw new Error(`Gemini API returned ${response.status}: ${data.error?.message?.slice(0, 200) ?? 'unknown error'}`);
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
): Promise<{ problem: GeneratedProblem; testCases: Array<GeneratedTestCase> }> {
  const problemText = await callGemini({
    apiKey,
    model,
    system: problemSystemPrompt(options),
    userMessage: 'Generate a C programming problem.',
    maxTokens: 2048,
    responseSchema: problemResponseSchema,
  });
  const problem = parseProblem(problemText);

  const testCaseText = await callGemini({
    apiKey,
    model,
    system: testCaseSystemPrompt(problem, options),
    userMessage: 'Generate the test cases as specified.',
    maxTokens: 2048,
    responseSchema: testCasesResponseSchema,
  });

  return { problem, testCases: finalizeCases(parseTestCases(testCaseText)) };
}

/**
 * One-call compact flow (default): the problem and its test cases arrive in a
 * single response with tight caps, roughly halving the token spend. The prompt
 * stresses brevity: no prose, small samples, few test cases.
 */
export async function generateWithGeminiCompact(
  apiKey: string,
  options: GenerateOptions,
  model?: string,
): Promise<{ problem: GeneratedProblem; testCases: Array<GeneratedTestCase> }> {
  const hidden = Math.max(options.testCaseCount - options.publicTestCaseCount, 1);
  const system = `You create exam-style C programming problems for second-year CS students. Output strictly valid JSON, nothing else. Be terse: the description is markdown but under 120 words; sample input/output are small (<= 6 numbers or <= 40 chars); the reference solution is minimal C99 with no comments. Integer arithmetic only; no floating point unless precision is stated. The reference_solution must compile with gcc -Wall -Wextra -std=c99 and exactly produce sample_output from sample_input.`;

  const userMessage = `Create ONE problem.
difficulty: ${options.difficulty}
topics: ${options.topics.join(', ')}
time limit seconds: 2
memory limit MB: 256
test cases: exactly ${options.testCaseCount} — the first ${options.publicTestCaseCount} public (is_public true, includes the sample pair), the remaining ${hidden} hidden edge/boundary cases. Each expected_output must be exactly reproducible from its input.${learnerIntentBlock(options)}
JSON shape: {"title": string, "description": string, "constraints": {"time_limit_seconds": number, "memory_limit_mb": number, "input_format": string, "output_format": string, "sample_input": string, "sample_output": string}, "tags": string[2..3], "difficulty": "${options.difficulty}", "reference_solution": string, "test_cases": [{"input": string, "expected_output": string, "is_public": boolean, "description": string}]}`;

  const text = await callGemini({
    apiKey,
    model,
    system,
    userMessage,
    maxTokens: 3072,
    temperature: 0.6,
    responseSchema: {
      type: 'object',
      properties: {
        ...(problemResponseSchema.properties as Record<string, unknown>),
        test_cases: (testCasesResponseSchema.properties as Record<string, unknown>).test_cases,
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

  return { problem, testCases };
}
