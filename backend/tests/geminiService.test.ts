import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateWithGeminiCompact } from '../src/services/geminiService.js';

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
});
