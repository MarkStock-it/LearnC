import { useState, type CSSProperties } from 'react';
import type { ErrorType, SubmissionResponse, TestCaseResult } from '../../services/api';
import { StatusMark, type MarkKind } from '../ui/StatusMark';
import { CompilerFeedback } from '../Editor/CompilerFeedback';
import { DiffView } from './DiffView';
import { formatDateTime } from '../../lib/format';

const VERDICT: Record<ErrorType, { mark: MarkKind; word: string; className: string }> = {
  PASS: { mark: 'pass', word: 'Passed', className: 'verdict-pass' },
  WRONG_ANSWER: { mark: 'wrong', word: 'Wrong answer', className: 'verdict-fail' },
  TIMEOUT: { mark: 'timeout', word: 'Timed out', className: 'verdict-warn' },
  RUNTIME_ERROR: { mark: 'crash', word: 'Runtime error', className: 'verdict-fail' },
  COMPILATION_ERROR: { mark: 'wrong', word: 'Compile error', className: 'verdict-fail' },
};

function TestCaseRow({
  result,
  index,
  timeLimitSeconds,
}: {
  result: TestCaseResult;
  index: number;
  timeLimitSeconds: number | null;
}) {
  const [open, setOpen] = useState(false);
  const verdict = VERDICT[result.errorType];
  const slow = result.runtimeMs !== null && timeLimitSeconds !== null && result.runtimeMs > timeLimitSeconds * 1000 * 0.7;

  return (
    <li className="border-t border-[var(--color-rule)] first:border-t-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="row-hover flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-start"
      >
        <span className={`flex items-center gap-2 ${verdict.className}`}>
          <StatusMark kind={verdict.mark} />
          <span className="type-small">{verdict.word}</span>
        </span>

        <span className="type-small min-w-0 text-[var(--color-ink)]">
          {result.isPublic ? `Test case ${index + 1}` : (result.label ?? 'Hidden case')}
          {result.description ? <span className="type-micro ms-2">{result.description}</span> : null}
        </span>

        <span className={`num type-micro ms-auto ${slow ? 'verdict-warn' : ''}`}>
          {result.runtimeMs !== null ? `${result.runtimeMs} ms` : '—'}
          {slow ? ' (slow)' : ''}
        </span>
      </button>

      <div className="disclose-row" data-open={open}>
        <div>
          <div className="flex flex-col gap-[var(--space-sm)] px-4 pb-[var(--space-md)]">
            <p className="type-small text-[var(--color-muted)]">{result.message}</p>

            {result.isPublic ? (
              <div className="grid gap-[var(--space-xs)] md:grid-cols-3">
                <div className="well p-[var(--space-sm)]">
                  <p className="type-micro mb-1">Input</p>
                  <pre className="mono max-h-40 overflow-auto text-[var(--text-small)] whitespace-pre-wrap">
                    {result.inputData || '(empty)'}
                  </pre>
                </div>
                <div className="well p-[var(--space-sm)]">
                  <p className="type-micro mb-1">Expected</p>
                  <pre className="mono max-h-40 overflow-auto text-[var(--text-small)] whitespace-pre-wrap text-[var(--color-pass)]">
                    {result.expectedOutput || '(empty)'}
                  </pre>
                </div>
                <div className="well p-[var(--space-sm)]">
                  <p className="type-micro mb-1">Your output</p>
                  <pre className="mono max-h-40 overflow-auto text-[var(--text-small)] whitespace-pre-wrap text-[var(--color-fail)]">
                    {result.actualOutput || '(empty)'}
                  </pre>
                </div>
              </div>
            ) : (
              <p className="type-small text-[var(--color-muted)]">
                Hidden cases keep their input and expected output on the server. Re-read the statement for the
                boundary the case describes, or compare against the visible samples.
              </p>
            )}

            {result.stderr && result.stderr.trim().length > 0 ? (
              <div>
                <p className="type-micro mb-1">Standard error</p>
                <pre className="well mono max-h-40 overflow-auto p-[var(--space-sm)] text-[var(--text-small)] whitespace-pre-wrap text-[var(--color-warn)]">
                  {result.stderr}
                </pre>
              </div>
            ) : null}

            {result.diff && result.diff.length > 0 ? (
              <div>
                <p className="type-micro mb-1">Differences</p>
                <DiffView diff={result.diff} />
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </li>
  );
}

/** Verdict first, evidence underneath. The ratio is the only large figure on the page. */
export function TestResultsTable({ detail }: { detail: SubmissionResponse }) {
  const { submission, results, limits } = detail;
  const compileFailed = submission.compilationError !== null;
  const allPassed = submission.totalCount > 0 && submission.passedCount === submission.totalCount;
  const ratio = submission.totalCount > 0 ? submission.passedCount / submission.totalCount : 0;
  const outcome = allPassed ? 'complete' : submission.passedCount > 0 ? 'partial' : 'none';

  const headline = compileFailed
    ? 'The compiler rejected this code'
    : allPassed
      ? 'Every test case passed'
      : `${submission.passedCount} of ${submission.totalCount} test cases passed`;

  return (
    <div className="flex flex-col gap-[var(--space-md)]">
      <section className="surface p-[var(--space-lg)]" aria-labelledby="verdict-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
          <div className="min-w-0">
            <h3 id="verdict-heading" className="type-title flex items-center gap-2">
              {!compileFailed ? (
                <span className={allPassed ? 'verdict-pass' : 'verdict-fail'} aria-hidden>
                  <StatusMark kind={allPassed ? 'pass' : 'wrong'} />
                </span>
              ) : null}
              {headline}
            </h3>
            <p className="type-small mt-1 text-[var(--color-muted)]">
              Graded by the {submission.executor ?? 'sandbox'} sandbox
              {submission.completedAt ? `, ${formatDateTime(submission.completedAt)}` : ''}.
              {limits.timeLimitSeconds ? ` Limit ${limits.timeLimitSeconds}s per case.` : ''}
            </p>
          </div>

          <div className="shrink-0">
            <p className="num text-[var(--text-xl)] font-[var(--weight-display)] leading-[var(--leading-display)] tracking-[var(--tracking-display)]">
              {submission.passedCount}
              <span className="text-[var(--color-faint)]">/{submission.totalCount}</span>
            </p>
            {/* The figure says how many; the bar says how it went, at a glance. The fill
             * carries the outcome in colour AND in length, so it never relies on hue alone. */}
            <div
              className="ratio mt-[var(--space-2xs)] w-[7rem]"
              role="img"
              aria-label={`${submission.passedCount} of ${submission.totalCount} test cases passed`}
            >
              <span
                className="ratio-fill"
                data-outcome={outcome}
                style={{ '--ratio': ratio } as CSSProperties}
              />
            </div>
          </div>
        </div>
      </section>

      <CompilerFeedback compilationError={submission.compilationError} />

      {submission.errorMessage ? (
        <p className="type-small text-[var(--color-fail)]" role="alert">
          The grader reported an infrastructure error: {submission.errorMessage}
        </p>
      ) : null}

      {results.length > 0 ? (
        <ul className="surface overflow-hidden">
          {results.map((result, index) => (
            <TestCaseRow
              key={`${result.testCaseId ?? 'case'}-${index}`}
              result={result}
              index={index}
              timeLimitSeconds={limits.timeLimitSeconds}
            />
          ))}
        </ul>
      ) : null}
    </div>
  );
}
