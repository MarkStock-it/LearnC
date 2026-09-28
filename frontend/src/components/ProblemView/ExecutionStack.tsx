import { useMemo, useState } from 'react';
import type { SubmissionResponse, TestCaseResult } from '../../services/api';
import { StatusMark } from '../ui/StatusMark';

/**
 * The Execution stack panel, ported from the workbench concept and kept honest: there
 * is no debugger attached to the sandbox, so this panel never invents gdb frames.
 * What the grader really produces — signal verdicts, stderr, timing — is arranged as a
 * backtrace-shaped chain of frames: the crash verdict first, then the stderr excerpt
 * that explains it, then the student-language "why" the concept promised.
 */

interface StackFrame {
  /** Backtrace-style label, e.g. "#1 main — SIGSEGV". */
  head: string;
  sub: string;
  detail: string;
}

function frameForResult(result: TestCaseResult, index: number): StackFrame | null {
  if (result.passed) return null;

  const label = result.isPublic ? `test case ${index + 1}` : (result.label ?? 'a hidden case');

  if (result.errorType === 'RUNTIME_ERROR') {
    // The sandbox reports crashes as exit > 128; 128 + signal = the exit code is not
    // forwarded per-case, so the panel speaks of the crash class, not a fake frame.
    const stderrLine = (result.stderr ?? '').split('\n').find((l) => l.trim().length > 0);
    return {
      head: `#1 ${label} — crashed`,
      sub: result.runtimeMs !== null ? `${result.runtimeMs} ms` : 'while running',
      detail:
        (stderrLine && stderrLine.slice(0, 200)) ||
        'The program terminated abnormally mid-case. Check array bounds, pointer initialisation, and scanf return values before use.',
    };
  }

  if (result.errorType === 'TIMEOUT') {
    return {
      head: `#1 ${label} — still running when the limit hit`,
      sub: result.runtimeMs !== null ? `${result.runtimeMs} ms` : 'at the time limit',
      detail:
        'Execution never reached the end of this case: an unbounded loop, a missing scanf, or an algorithm too slow for the limit. The run was killed at the wall.',
    };
  }

  return null;
}

function collectFrames(detail: SubmissionResponse): StackFrame[] {
  const frames: StackFrame[] = [];
  detail.results.forEach((result, index) => {
    const frame = frameForResult(result, index);
    if (frame) frames.push(frame);
  });
  return frames;
}

/**
 * Reads like gdb's backtrace and lives next to the test cases it explains. Each frame
 * expands to the "why" in student language.
 */
export function ExecutionStack({ detail }: { detail: SubmissionResponse }) {
  const { submission } = detail;
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  const frames = useMemo(() => collectFrames(detail), [detail]);

  if (submission.compilationError) {
    // The compiler output panel already speaks for a failed build; a fake backtrace
    // would be noise on top of noise.
    return null;
  }

  if (frames.length === 0) {
    return (
      <section className="surface p-[var(--space-md)]" aria-label="Execution stack">
        <h3 className="type-title flex items-center gap-2">
          <span className="verdict-pass" aria-hidden>
            <StatusMark kind="pass" />
          </span>
          Execution stack
        </h3>
        <p className="type-small mt-1 text-[var(--color-muted)]">
          No crashes, no timeouts — the program ran to the end of every case. There is no stack to unwind.
        </p>
      </section>
    );
  }

  const crashCount = frames.length;

  return (
    <section className="surface p-[var(--space-md)]" aria-label="Execution stack">
      <h3 className="type-title flex flex-wrap items-center gap-2">
        Execution stack
        <span className="tag verdict-fail" style={{ border: '1px solid var(--color-rule)' }}>
          {crashCount === 1 ? '1 case ended abnormally' : `${crashCount} cases ended abnormally`}
        </span>
      </h3>

      <div className="mt-[var(--space-sm)] flex flex-col">
        {frames.map((frame, index) => {
          const open = openIndex === index;
          return (
            <div key={`${frame.head}-${index}`} className="border-t border-[var(--color-rule)] first:border-t-0">
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpenIndex(open ? null : index)}
                className="row-hover flex w-full items-baseline gap-x-3 gap-y-1 py-2.5 text-start"
              >
                <span className="mono type-small font-[var(--weight-medium)] text-[var(--color-ink)]">
                  {frame.head}
                </span>
                <span className="num type-micro ms-auto">{frame.sub}</span>
              </button>
              <div className="disclose-row" data-open={open}>
                <div>
                  <p className="type-small px-1 pb-[var(--space-sm)] text-[var(--color-ink-soft)]">{frame.detail}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <p className="type-micro mt-2">
        The sandbox does not attach a debugger, so this is the verdict chain — not a true backtrace. The stderr of a
        crashed case is shown on its test-case row.
      </p>
    </section>
  );
}
