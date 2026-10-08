/**
 * Output comparison for the browser preview.
 *
 * The preview now compiles with real clang, so no source rewriting is needed
 * anymore — student code goes to the compiler verbatim. What remains here is
 * the verdict logic, a byte-semantics mirror of the server judge
 * (`backend/src/utils/text.ts` `normalizeOutput` + `computeDiff` in
 * `backend/src/services/evaluationService.ts`). Kept in sync by hand; the
 * regression battery cross-checks verdicts against gcc + the server build.
 */

/**
 * Byte-semantics mirror of the server judge: CR/LF folding, trailing blank
 * trimming per line, and no leading/trailing blank lines.
 */
export function normalizeOutput(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n+$/, '')
    .replace(/^\n+/, '');
}

export interface OutputDiffLine {
  line: number;
  expected: string;
  actual: string;
}

/** Mirror of `computeDiff` in `backend/src/services/evaluationService.ts`. */
export function computeOutputDiff(expected: string, actual: string): OutputDiffLine[] {
  const expectedLines = expected.split('\n');
  const actualLines = actual.split('\n');
  const diff: OutputDiffLine[] = [];
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
    if (diff.length >= 20) break;
  }
  return diff;
}

export function compareOutputs(expected: string, actual: string): { passed: boolean; diff: OutputDiffLine[] } {
  const normalizedExpected = normalizeOutput(expected);
  const normalizedActual = normalizeOutput(actual);
  const passed = normalizedExpected === normalizedActual;
  return { passed, diff: passed ? [] : computeOutputDiff(normalizedExpected, normalizedActual) };
}
