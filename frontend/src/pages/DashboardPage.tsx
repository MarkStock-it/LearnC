import { useQuery } from '@tanstack/react-query';
import { api } from '../services/api';
import { ProblemSetSelector } from '../components/Dashboard/ProblemSetSelector';
import { SubmissionHistory } from '../components/Dashboard/SubmissionHistory';
import { StatusMark } from '../components/ui/StatusMark';
import { revealDelay } from '../lib/reveal';

/**
 * Ledger macrostructure: a wide primary column of problem sets against a narrower
 * rail of figures and recent activity. The split is deliberately uneven — equal
 * columns read as a template.
 *
 * Every number on this page comes from the API. Nothing here is invented to fill a
 * stat slot; an empty state says so rather than showing a plausible-looking figure.
 */
export function DashboardPage() {
  const health = useQuery({ queryKey: ['health'], queryFn: api.health, refetchInterval: 30_000 });
  const problemSets = useQuery({ queryKey: ['problemSets'], queryFn: api.problemSets });
  const dashboard = useQuery({ queryKey: ['dashboard'], queryFn: api.dashboard });
  const history = useQuery({ queryKey: ['submissions'], queryFn: () => api.submissions({ mine: true, limit: 8 }) });

  const sandbox = health.data?.sandbox;
  const ready = health.data?.status === 'ok' && sandbox?.available === true;
  const stats = dashboard.data?.stats;

  return (
    <div className="flex flex-col gap-[var(--space-2xl)]">
      <header className="reveal" style={revealDelay(0)}>
        <h1 className="type-display">Problem sets</h1>
        <p className="type-lede measure mt-[var(--space-xs)]">
          Pick a set, write C in the editor, and the grader compiles it and runs every test case, visible and hidden.
        </p>
      </header>

      <div className="grid gap-[var(--space-2xl)] lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:gap-[var(--space-xl)]">
        <section className="reveal min-w-0" style={revealDelay(1)} aria-labelledby="sets-heading">
          <h2 id="sets-heading" className="type-title mb-[var(--space-sm)]">
            Exam bundles
          </h2>
          {problemSets.isLoading ? (
            <p className="type-small text-[var(--color-muted)]">Loading problem sets…</p>
          ) : problemSets.isError ? (
            <p className="type-small text-[var(--color-fail)]">
              Problem sets could not be loaded: {(problemSets.error as Error).message}
            </p>
          ) : (
            <ProblemSetSelector problemSets={problemSets.data?.problemSets ?? []} />
          )}
        </section>

        <aside className="reveal flex min-w-0 flex-col gap-[var(--space-xl)]" style={revealDelay(2)}>
          <section className="surface p-[var(--space-lg)]" aria-labelledby="progress-heading">
            <h2 id="progress-heading" className="type-title">
              Your progress
            </h2>

            <p className="num mt-[var(--space-sm)] text-[var(--text-xl)] font-[var(--weight-display)] leading-[var(--leading-display)] tracking-[var(--tracking-display)]">
              {stats ? stats.solvedProblems : '—'}
              <span className="type-small ms-2 font-[var(--weight-body)] tracking-normal text-[var(--color-muted)]">
                {stats
                  ? stats.attemptedProblems === 0
                    ? 'no problems attempted yet'
                    : `of ${stats.attemptedProblems} attempted`
                  : ''}
              </span>
            </p>

            <dl className="mt-[var(--space-md)] flex flex-col gap-[var(--space-xs)]">
              <div className="flex items-baseline justify-between gap-4">
                <dt className="type-small text-[var(--color-muted)]">Submissions graded</dt>
                <dd className="num type-small">{stats ? stats.completedSubmissions : '—'}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-4">
                <dt className="type-small text-[var(--color-muted)]">Solve rate</dt>
                <dd className="num type-small">
                  {stats && stats.attemptedProblems > 0
                    ? `${Math.round((stats.solvedProblems / stats.attemptedProblems) * 100)}%`
                    : '—'}
                </dd>
              </div>
            </dl>
          </section>

          <section className="surface p-[var(--space-lg)]" aria-labelledby="grader-heading">
            <h2 id="grader-heading" className="type-title">
              Grader
            </h2>

            <p className="mt-[var(--space-sm)] flex items-center gap-2">
              <span className={ready ? 'verdict-pass' : 'verdict-fail'}>
                <StatusMark kind={ready ? 'pass' : 'crash'} />
              </span>
              <span className="type-small">{ready ? 'Ready to grade' : 'Not ready'}</span>
            </p>

            {!ready && sandbox ? <p className="type-micro mt-1">{sandbox.detail}</p> : null}

            <dl className="mt-[var(--space-md)] flex flex-col gap-[var(--space-2xs)]">
              <div className="flex items-baseline justify-between gap-4">
                <dt className="type-micro">Sandbox</dt>
                <dd className="mono type-micro text-[var(--color-muted)]">{sandbox?.kind ?? '—'}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-4">
                <dt className="type-micro">Queue</dt>
                <dd className="mono type-micro text-[var(--color-muted)]">{health.data?.queue.driver ?? '—'}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-4">
                <dt className="type-micro">Store</dt>
                <dd className="mono type-micro text-[var(--color-muted)]">{health.data?.database.client ?? '—'}</dd>
              </div>
            </dl>
          </section>

          <section className="min-w-0" aria-labelledby="recent-heading">
            <h2 id="recent-heading" className="type-title mb-[var(--space-sm)]">
              Recent submissions
            </h2>
            {history.isLoading ? (
              <p className="type-small text-[var(--color-muted)]">Loading…</p>
            ) : (
              <SubmissionHistory submissions={history.data?.submissions ?? []} />
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
