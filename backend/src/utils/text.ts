/** Pure text helpers shared by the evaluator, repositories and API layer. */

/**
 * Normalise program output before comparison (plan §9.1).
 *
 * CRLF/CR → LF, strip trailing whitespace per line, drop leading/trailing blank
 * lines. Leading indentation is preserved: it can be semantically meaningful.
 * This matters more than the plan implies — a Windows-compiled binary emits `\r\n`,
 * so a byte-exact judge fails correct programs.
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

/** Trim a string to a UTF-8 byte budget, marking anything that was cut. */
export function truncate(text: string, maxBytes = 64 * 1024): string {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
  const buffer = Buffer.from(text, 'utf8').subarray(0, maxBytes);
  return `${buffer.toString('utf8')}\n… [truncated]`;
}
