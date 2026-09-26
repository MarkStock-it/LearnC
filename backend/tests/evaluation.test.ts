import { describe, expect, it } from 'vitest';
import {
  classifyProcessOutcome,
  compareOutput,
  computeDiff,
  describeErrorType,
  normalizeOutput,
  truncate,
} from '../src/services/evaluationService.js';

describe('normalizeOutput', () => {
  it('treats CRLF and LF as equivalent (Windows toolchains emit CRLF)', () => {
    expect(normalizeOutput('6\r\n')).toBe('6');
    expect(normalizeOutput('1\r\n2\r\n3\r\n')).toBe(normalizeOutput('1\n2\n3\n'));
  });

  it('normalises bare carriage returns', () => {
    expect(normalizeOutput('a\rb')).toBe('a\nb');
  });

  it('ignores trailing whitespace and trailing blank lines', () => {
    expect(normalizeOutput('hello   \n\n\n')).toBe('hello');
  });

  it('preserves leading indentation because it can be meaningful', () => {
    expect(normalizeOutput('  indented\n')).toBe('  indented');
  });

  it('keeps interior blank lines', () => {
    expect(normalizeOutput('a\n\nb\n')).toBe('a\n\nb');
  });
});

describe('compareOutput', () => {
  it('accepts a CRLF answer for an LF expectation', () => {
    expect(compareOutput('6\n', '6\r\n').passed).toBe(true);
  });

  it('rejects different values and returns a diff', () => {
    const result = compareOutput('6\n', '40\n');
    expect(result.passed).toBe(false);
    expect(result.diff).toEqual([{ line: 1, expected: '6', actual: '40' }]);
  });

  it('flags missing lines', () => {
    const result = compareOutput('1\n2\n3\n', '1\n2\n');
    expect(result.passed).toBe(false);
    expect(result.diff).toEqual([{ line: 3, expected: '3', actual: '(missing)' }]);
  });

  it('flags extra lines', () => {
    const result = compareOutput('1\n', '1\n2\n');
    expect(result.diff).toEqual([{ line: 2, expected: '(missing)', actual: '2' }]);
  });

  it('reports no diff when outputs match', () => {
    expect(compareOutput('5\n', '5\n').diff).toEqual([]);
  });
});

describe('computeDiff', () => {
  it('caps the diff so one submission cannot return thousands of lines', () => {
    const expected = Array.from({ length: 100 }, (_, i) => `expected-${i}`).join('\n');
    const actual = Array.from({ length: 100 }, (_, i) => `actual-${i}`).join('\n');
    expect(computeDiff(expected, actual)).toHaveLength(20);
  });
});

describe('classifyProcessOutcome', () => {
  it('maps a clean run with matching stdout to PASS', () => {
    expect(classifyProcessOutcome({ exitCode: 0, timedOut: false, stderr: '', stdoutMatched: true })).toBe('PASS');
  });

  it('maps mismatched stdout to WRONG_ANSWER', () => {
    expect(classifyProcessOutcome({ exitCode: 0, timedOut: false, stderr: '', stdoutMatched: false })).toBe(
      'WRONG_ANSWER',
    );
  });

  it('maps the wall-clock kill to TIMEOUT', () => {
    expect(classifyProcessOutcome({ exitCode: null, timedOut: true, stderr: '', stdoutMatched: false })).toBe('TIMEOUT');
    expect(classifyProcessOutcome({ exitCode: 124, timedOut: false, stderr: '', stdoutMatched: false })).toBe('TIMEOUT');
    expect(classifyProcessOutcome({ exitCode: 137, timedOut: false, stderr: '', stdoutMatched: false })).toBe('TIMEOUT');
  });

  it('maps crashes to RUNTIME_ERROR, even when the output happens to match', () => {
    expect(classifyProcessOutcome({ exitCode: 139, timedOut: false, stderr: '', stdoutMatched: true })).toBe(
      'RUNTIME_ERROR',
    );
    expect(classifyProcessOutcome({ exitCode: 3, timedOut: false, stderr: '', stdoutMatched: true })).toBe(
      'RUNTIME_ERROR',
    );
  });

  it('has a human-readable description for every verdict', () => {
    for (const verdict of ['PASS', 'WRONG_ANSWER', 'TIMEOUT', 'RUNTIME_ERROR', 'COMPILATION_ERROR'] as const) {
      expect(describeErrorType(verdict).length).toBeGreaterThan(0);
    }
  });
});

describe('truncate', () => {
  it('leaves small payloads untouched', () => {
    expect(truncate('short', 1024)).toBe('short');
  });

  it('marks payloads that exceeded the byte budget', () => {
    const result = truncate('x'.repeat(5000), 100);
    expect(result).toContain('truncated');
    expect(Buffer.byteLength(result, 'utf8')).toBeLessThan(5000);
  });
});
