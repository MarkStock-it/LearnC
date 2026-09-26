import type { DiffLine, ErrorType } from '../domain/types.js';
import { normalizeOutput, truncate } from '../utils/text.js';

// Re-exported so evaluation logic has a single documented entry point
// (`services/evaluationService.ts`, plan §11).
export { normalizeOutput, truncate };

/** Line-by-line diff used to explain a mismatch in the UI (plan §9.1). */
export function computeDiff(expected: string, actual: string): DiffLine[] {
  const expectedLines = expected.split('\n');
  const actualLines = actual.split('\n');
  const diff: DiffLine[] = [];
  const total = Math.max(expectedLines.length, actualLines.length);

  for (let i = 0; i < total; i += 1) {
    const exp = expectedLines[i];
    const act = actualLines[i];
    if (exp === act) continue;
    diff.push({
      line: i + 1,
      expected: exp === undefined ? '(missing)' : exp,
      actual: act === undefined ? '(missing)' : act,
    });
    // Keep the payload small: the first difference is usually the actionable one.
    if (diff.length >= 20) break;
  }
  return diff;
}

export interface ComparisonResult {
  passed: boolean;
  diff: DiffLine[];
  normalizedExpected: string;
  normalizedActual: string;
}

export function compareOutput(expectedOutput: string, actualOutput: string): ComparisonResult {
  const normalizedExpected = normalizeOutput(expectedOutput);
  const normalizedActual = normalizeOutput(actualOutput);
  const passed = normalizedExpected === normalizedActual;

  return {
    passed,
    diff: passed ? [] : computeDiff(normalizedExpected, normalizedActual),
    normalizedExpected,
    normalizedActual,
  };
}

/**
 * Map a finished process to a judge verdict.
 * `timeout` exits 124; SIGKILL reports 137 (128+9); other >128 codes are signals
 * (139 = SIGSEGV), which are crashes rather than timeouts.
 */
export function classifyProcessOutcome(options: {
  exitCode: number | null;
  timedOut: boolean;
  stderr: string;
  stdoutMatched: boolean;
}): ErrorType {
  const { exitCode, timedOut, stdoutMatched } = options;
  if (timedOut || exitCode === 124 || exitCode === 137) return 'TIMEOUT';
  if (exitCode !== 0 && exitCode !== null) return 'RUNTIME_ERROR';
  if (!stdoutMatched) return 'WRONG_ANSWER';
  return 'PASS';
}

/** Human-readable explanation for a non-passing verdict. */
export function describeErrorType(errorType: ErrorType): string {
  switch (errorType) {
    case 'PASS':
      return 'Accepted';
    case 'WRONG_ANSWER':
      return 'Output does not match the expected result';
    case 'TIMEOUT':
      return 'Execution exceeded the time limit';
    case 'RUNTIME_ERROR':
      return 'The program terminated abnormally (crash or non-zero exit)';
    case 'COMPILATION_ERROR':
      return 'The compiler rejected this code';
  }
}
