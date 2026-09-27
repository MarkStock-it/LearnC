import { config } from '../config.js';
import {
  generatedProblemSchema,
  generatedTestCasesSchema,
  type GeneratedProblem,
  type GeneratedTestCase,
} from '../domain/problem.js';
import type { GenerateOptions } from './aiService.js';

/**
 * Gemini client (Generative Language REST API). Kept deliberately small: two
 * calls per generation (problem, then test cases) with the same §4.1/§4.2
 * system prompts the other providers use, Zod-validated like every provider.
 */

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  error?: { message?: string };
}

async function callGemini(apiKey: string, system: string, userMessage: string, maxTokens: number): Promise<string> {
  const response = await fetch(`${BASE_URL}/models/${config.ai.model}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: userMessage }] }],
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature: 0.7,
      },
    }),
    signal: AbortSignal.timeout(config.ai.timeoutMs),
  });

  const data = (await response.json().catch(() => ({}))) as GeminiResponse;
  if (!response.ok) {
    throw new Error(`Gemini API returned ${response.status}: ${data.error?.message?.slice(0, 200) ?? 'unknown error'}`);
  }

  return (data.candidates?.[0]?.content?.parts ?? [])
    .map((part) => part.text ?? '')
    .join('')
    .trim();
}

/**
 * Generate a problem bundle with a student's own Gemini key. Throws on failure —
 * the caller decides whether to fall back to the server provider or the bank.
 */
export async function generateWithGemini(
  apiKey: string,
  options: GenerateOptions,
): Promise<{ problem: GeneratedProblem; testCases: GeneratedTestCase[] }> {
  const problemText = await callGemini(apiKey, problemSystemPrompt(options), 'Generate a C programming problem.', 2500);
  const problem = generatedProblemSchema.parse(extractJson(problemText));

  const testCaseText = await callGemini(
    apiKey,
    testCaseSystemPrompt(problem, options),
    'Generate the test cases as specified.',
    3000,
  );
  const parsedCases = generatedTestCasesSchema.parse(extractJson(testCaseText));

  if (parsedCases.test_cases.length < 2) {
    throw new Error('Fewer than two test cases were generated');
  }
  if (!parsedCases.test_cases.some((testCase) => testCase.is_public)) {
    parsedCases.test_cases[0]!.is_public = true;
  }

  return { problem, testCases: parsedCases.test_cases };
}

import { extractJson, problemSystemPrompt, testCaseSystemPrompt } from './aiPrompts.js';
