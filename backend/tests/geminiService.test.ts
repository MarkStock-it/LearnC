import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateWithGemini, generateWithGeminiCompact } from '../src/services/geminiService.js';
import { GeminiQuotaError, resetGeminiBudgetsForTests } from '../src/services/aiQuota.js';

const options = {
  difficulty: 'easy' as const,
  topics: ['arrays'],
  testCaseCount: 6,
  publicTestCaseCount: 2,
};

function responseFor(text: string, status = 200): Response {
  return new Response(JSON.stringify(status === 200
    ? { candidates: [{ content: { parts: [{ text }] } }] }
    : { error: { message: text } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const compactResult = JSON.stringify({
  title: 'Sum the Array Values',
  description: 'Read a list of integers and print their sum. Explain the input and output formats clearly.',
  constraints: {
    time_limit_seconds: 2,
    memory_limit_mb: 256,
    input_format: 'An integer n followed by n values.',
    output_format: 'Print the sum as an integer.',
    sample_input: '2 3 4',
    sample_output: '7',
  },
  tags: ['arrays'],
  difficulty: 'easy',
  reference_solution: '#include <stdio.h>\nint main(void) { return 0; }',
  test_cases: [
    { input: '2 3 4', expected_output: '7', is_public: true, description: 'Sample' },
    { input: '1 9', expected_output: '9', is_public: false, description: 'Single value' },
  ],
  helper_files: [],
});

beforeEach(() => resetGeminiBudgetsForTests());
afterEach(() => vi.unstubAllGlobals());

describe('Gemini request configuration', () => {
  it('sends valid Gemini 2.5 Flash thinking and structured-output fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue(responseFor(compactResult));
    vi.stubGlobal('fetch', fetchMock);

    await generateWithGeminiCompact('AIza-test-key', options, 'gemini-2.5-flash');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    const generationConfig = body.generationConfig as Record<string, unknown>;
    expect(url).toContain('/models/gemini-2.5-flash:generateContent');
    expect(body.systemInstruction).toBeDefined();
    expect(body).not.toHaveProperty('system_instruction');
    expect(generationConfig).toMatchObject({
      responseMimeType: 'application/json',
      temperature: 0.6,
      thinkingConfig: { thinkingBudget: 0 },
    });
  });

  it('uses Gemini 3 thinkingLevel without the legacy 2.5 thinkingBudget', async () => {
    const fetchMock = vi.fn().mockResolvedValue(responseFor(compactResult));
    vi.stubGlobal('fetch', fetchMock);

    await generateWithGeminiCompact('AIza-test-key', options, 'gemini-3.8-flash');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const { generationConfig } = JSON.parse(String(init.body)) as { generationConfig: Record<string, unknown> };
    expect(generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'low' });
    expect(generationConfig).not.toHaveProperty('thinkingBudget');
    expect(generationConfig).not.toHaveProperty('temperature');
  });

  it('explains when the API key/project cannot access a legacy Gemini 2.5 model', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(responseFor('Requested entity was not found.', 404)));

    await expect(generateWithGeminiCompact('AIza-test-key', options, 'gemini-2.5-flash'))
      .rejects.toThrow(/Gemini 2\.5 access is restricted/i);
  });

  it('turns HTTP 429 into a quota error the caller falls back from instead of retrying', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(responseFor('Quota exceeded for quota metric.', 429)));

    const error = await generateWithGeminiCompact('AIza-429-key', options).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(GeminiQuotaError);
    expect(String(error)).toMatch(/rate limit\/quota/i);
  });
});

describe('compact token budget', () => {
  it('scales the output ceiling with the case count and never asks for helper files', async () => {
    const fetchMock = vi.fn().mockResolvedValue(responseFor(compactResult));
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateWithGeminiCompact('AIza-scale-key', options, 'gemini-3.5-flash-lite');

    expect(result.warnings).toEqual([]);
    expect(result.helperFiles).toEqual([]);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as {
      generationConfig: { maxOutputTokens: number; responseSchema: { properties: Record<string, unknown> } };
    };
    expect(body.generationConfig.maxOutputTokens).toBe(1500 + 6 * 140);
    expect(body.generationConfig.responseSchema.properties.test_cases).toMatchObject({ maxItems: 6 });
    expect(body.generationConfig.responseSchema.properties).not.toHaveProperty('helper_files');
    expect(String(init.body)).not.toContain('helper_files');
  });

  it('caps runaway case counts at ten and says so in warnings', async () => {
    const fetchMock = vi.fn().mockResolvedValue(responseFor(compactResult));
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateWithGeminiCompact(
      'AIza-cap-key',
      { ...options, testCaseCount: 24, publicTestCaseCount: 3 },
      'gemini-3.5-flash-lite',
    );

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/10/);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as {
      generationConfig: { maxOutputTokens: number; responseSchema: { properties: Record<string, unknown> } };
    };
    expect(body.generationConfig.maxOutputTokens).toBe(1500 + 10 * 140);
    expect(body.generationConfig.responseSchema.properties.test_cases).toMatchObject({ maxItems: 10 });
  });
});

describe('two-call flow', () => {
  it('sends the test-case call a condensed statement instead of the full prose', async () => {
    const parsed = JSON.parse(compactResult) as Record<string, unknown>;
    const longProblemText = JSON.stringify({
      ...parsed,
      description: `${'x'.repeat(1500)}SHOULD_BE_TRIMMED_AWAY`,
    });
    const casesText = JSON.stringify({ test_cases: parsed.test_cases });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(responseFor(longProblemText))
      .mockResolvedValueOnce(responseFor(casesText))
      .mockResolvedValueOnce(responseFor(JSON.stringify({ helper_files: [] })));
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateWithGemini('AIza-condense-key', options, 'gemini-2.5-flash-lite');

    expect(result.testCases).toHaveLength(2);
    const calls = fetchMock.mock.calls as Array<[string, RequestInit]>;
    expect(calls).toHaveLength(3);
    const secondSystem = (JSON.parse(String(calls[1]![1].body)) as {
      systemInstruction: { parts: Array<{ text: string }> };
    }).systemInstruction.parts[0]!.text;
    expect(secondSystem).toContain('trimmed to keep the request small');
    expect(secondSystem).not.toContain('SHOULD_BE_TRIMMED_AWAY');
  });
});
