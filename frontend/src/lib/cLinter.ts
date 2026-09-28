/**
 * A deliberately small C linter: the two mistake classes that derail a beginner's
 * session — unbalanced brackets and missing statement terminators — surfaced as they
 * type, in gcc's voice (file:line: severity: message — plain-language fix).
 *
 * This is not a compiler and does not pretend to be one: it stays quiet about anything
 * ambiguous, so a wrong hint costs less than a missing one. The real verdict still
 * comes from the sandbox.
 */

export interface LintProblem {
  line: number;
  message: string;
}

export interface LintDiagnostic {
  line: number;
  /** gcc's own words for the severity level. */
  severity: 'error';
  message: string;
  /** The plain-language fix, rendered after an em dash. */
  fix: string;
}

const OPENERS = '([{';
const CLOSERS = ')]}';
const MATCH: Record<string, string> = { '(': ')', '[': ']', '{': '}' };

export function lintC(source: string): LintDiagnostic[] {
  const problems: LintProblem[] = [];
  const lines = source.split('\n');

  // Bracket balance with line tracking. Comments and literals are skipped so a
  // bracket inside a string never trips the counter.
  const stack: Array<{ ch: string; line: number }> = [];
  let inString = false;
  let inChar = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    for (let col = 0; col < line.length; col += 1) {
      const ch = line[col];
      const next = line[col + 1];

      if (inLineComment) break;
      if (inBlockComment) {
        if (ch === '*' && next === '/') {
          inBlockComment = false;
          col += 1;
        }
        continue;
      }
      if (inString) {
        if (ch === '\\') col += 1;
        else if (ch === '"') inString = false;
        continue;
      }
      if (inChar) {
        if (ch === '\\') col += 1;
        else if (ch === "'") inChar = false;
        continue;
      }
      if (ch === '/' && next === '/') {
        inLineComment = true;
        continue;
      }
      if (ch === '/' && next === '*') {
        inBlockComment = true;
        col += 1;
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === "'") {
        inChar = true;
        continue;
      }

      if (OPENERS.includes(ch)) {
        stack.push({ ch, line: lineIndex + 1 });
      } else if (CLOSERS.includes(ch)) {
        const open = stack.pop();
        if (!open) {
          problems.push({ line: lineIndex + 1, message: `unmatched "${ch}"` });
        } else if (MATCH[open.ch] !== ch) {
          problems.push({
            line: lineIndex + 1,
            message: `expected "${MATCH[open.ch]}" to close "${open.ch}" from line ${open.line}, found "${ch}"`,
          });
        }
      }
    }
    // Strings and line comments cannot span lines in C; the block comment state does.
    inLineComment = false;
    inString = false;
    inChar = false;
  }

  for (const open of stack) {
    problems.push({ line: open.line, message: `unclosed "${open.ch}"` });
  }

  // Statement terminators: a non-empty line that is not a brace, preprocessor,
  // control-flow head or comment should end in a semicolon (or a brace/comma/label).
  lines.forEach((line, index) => {
    const trimmed = line.replace(/\/\/.*$/, '').trim();
    if (trimmed.length === 0) return;
    if (trimmed.startsWith('#')) return;
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
    if (/[;{}:,]$/.test(trimmed)) return;
    if (/^(if|else|for|while|do|switch|case)\b/.test(trimmed)) return;
    problems.push({ line: index + 1, message: 'expected ";" at end of statement' });
  });

  problems.sort((a, b) => a.line - b.line);

  // gcc reports the first error per region loudest; showing every repeat would bury
  // the one that matters. Three lines, plus a count of the rest.
  const seen = new Set<number>();
  const diagnostics: LintDiagnostic[] = [];
  for (const problem of problems) {
    if (diagnostics.length >= 3) break;
    if (seen.has(problem.line)) continue;
    seen.add(problem.line);
    diagnostics.push({
      line: problem.line,
      severity: 'error',
      message: problem.message,
      fix: problem.message.includes(';')
        ? 'add ";" at the end of the statement'
        : problem.message.startsWith('unclosed')
          ? 'close it before the function ends'
          : 'balance the brackets',
    });
  }

  return diagnostics;
}
