import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, getQueryIdentity } from '../services/api';
import { isGuestMode } from '../lib/guestMode';
import { ProblemSetSelector } from '../components/Dashboard/ProblemSetSelector';
import { SubmissionHistory } from '../components/Dashboard/SubmissionHistory';
import { StatusMark } from '../components/ui/StatusMark';
import { revealDelay } from '../lib/reveal';
import { Pagination } from '../components/ui/Pagination';
import { Link } from 'react-router-dom';
import { formatDateTime } from '../lib/format';
import type { Difficulty, SubmissionSummary } from '../services/api';

const SUBMISSION_STATUS = {
  all: undefined,
  passed: 'COMPLETED',
  failed: 'FAILED',
} as const;

function outcome(submission: SubmissionSummary): { label: string; kind: 'pass' | 'partial' | 'fail' | 'pending' } {
  if (submission.status !== 'COMPLETED') return { label: submission.status === 'FAILED' ? 'Grader error' : 'In progress', kind: 'pending' };
  if (submission.totalCount > 0 && submission.passedCount === submission.totalCount) return { label: 'Passed', kind: 'pass' };
  return { label: submission.passedCount > 0 ? 'Partial' : 'Failed', kind: submission.passedCount > 0 ? 'partial' : 'fail' };
}

function greetingName(name: string | undefined): string {
  return name ? `, ${name}` : '';
}

function ContinueCard({ submissions }: { submissions: SubmissionSummary[] }) {
  const latest = submissions.find((submission) => submission.status === 'COMPLETED' && submission.totalCount > 0 && submission.passedCount < submission.totalCount);
  if (!latest) return null;
  const result = outcome(latest);
  const progress = latest.totalCount > 0 ? Math.round((latest.passedCount / latest.totalCount) * 100) : 0;

  return (
    <section className="bundle-continue surface" aria-labelledby="continue-heading">
      <div className="bundle-continue-copy">
        <p className="type-micro">CONTINUE PRACTICING</p>
        <h2 id="continue-heading" className="bundle-continue-title">{latest.problemTitle}</h2>
        <div className="bundle-continue-pills">
          <span className={`bundle-outcome bundle-outcome--${result.kind}`}>{result.label}</span>
          <span className="bundle-continue-meta">{latest.passedCount} of {latest.totalCount} tests passed</span>
        </div>
        <div className="bundle-test-progress" role="img" aria-label={`${latest.passedCount} of ${latest.totalCount} test cases passed`}>
          <span style={{ '--bundle-progress': `${progress}%` } as React.CSSProperties} />
        </div>
        <p className="type-micro">Last attempted {formatDateTime(latest.createdAt)}</p>
      </div>
      <Link to={`/problems/${latest.problemId}`} className="btn btn-primary bundle-continue-action">Continue problem</Link>
    </section>
  );
}

function WeeklyActivity({ submissions, loading }: { submissions: SubmissionSummary[]; loading: boolean }) {
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - index));
    date.setHours(0, 0, 0, 0);
    const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    const active = submissions.some((submission) => {
      const submittedAt = new Date(submission.createdAt.replace(' ', 'T'));
      return !Number.isNaN(submittedAt.getTime()) && `${submittedAt.getFullYear()}-${submittedAt.getMonth()}-${submittedAt.getDate()}` === key;
    });
    return { date, active };
  });
  const count = days.filter((day) => day.active).length;
  return (
    <section className="bundle-side-card surface" aria-labelledby="activity-heading">
      <h2 id="activity-heading" className="type-title">This week</h2>
      <p className="type-micro mt-1">{loading ? 'Loading activity…' : count ? `${count} active ${count === 1 ? 'day' : 'days'} in the last 7 days` : 'No submissions in the last 7 days'}</p>
      <div className="bundle-week-grid" aria-label="Submission activity for the last seven days">
        {days.map(({ date, active }) => (
          <div key={date.toISOString()} className="bundle-week-day">
            <span className={`bundle-week-mark ${active ? 'bundle-week-mark--active' : ''}`} aria-hidden="true" />
            <span>{date.toLocaleDateString('en', { weekday: 'narrow' })}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function TopicSummary({ submissions, problems, loading }: { submissions: SubmissionSummary[]; problems: Array<{ id: number; title: string; tags: string[] }>; loading: boolean }) {
  const activityCounts = new Map<string, number>();
  const problemsById = new Map(problems.map((problem) => [problem.id, problem]));
  submissions.forEach((submission) => {
    const problem = problemsById.get(submission.problemId);
    problem?.tags.forEach((tag) => activityCounts.set(tag, (activityCounts.get(tag) ?? 0) + 1));
  });
  const topics = [...activityCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  return (
    <section className="bundle-side-card surface" aria-labelledby="topic-summary-heading">
      <h2 id="topic-summary-heading" className="type-title">Recent topics</h2>
      {loading ? <p className="type-small mt-2 text-[var(--color-muted)]">Loading recent topics…</p> : topics.length ? (
        <ul className="bundle-topic-list">
          {topics.map(([tag, count]) => (
            <li key={tag}><span>{tag}</span><span className="type-micro">{count} {count === 1 ? 'submission' : 'submissions'}</span></li>
          ))}
        </ul>
      ) : <p className="type-small mt-2 text-[var(--color-muted)]">Topic insights will appear after your first submission.</p>}
    </section>
  );
}

function starterBundles(bundles: Array<{ id: number; title: string; description: string | null; difficulty: Difficulty; problemCount: number }>) {
  return bundles.slice(0, 2);
}

/**
 * Ledger macrostructure: a wide primary column of problem sets against a narrower
 * rail of figures and recent activity. The split is deliberately uneven — equal
 * columns read as a template.
 *
 * Every number on this page comes from the API. Nothing here is invented to fill a
 * stat slot; an empty state says so rather than showing a plausible-looking figure.
 */
export function DashboardPage({ workspaceMode = false }: { workspaceMode?: boolean }) {
  const identity = getQueryIdentity();
  const guest = isGuestMode();
  const [setsOffset, setSetsOffset] = useState(0);
  const [historyOffset, setHistoryOffset] = useState(0);
  const [submissionFilter, setSubmissionFilter] = useState<keyof typeof SUBMISSION_STATUS>('all');
  const health = useQuery({ queryKey: ['health'], queryFn: api.health, refetchInterval: 30_000 });
  const problemSets = useQuery({
    queryKey: ['problemSets', identity, setsOffset],
    queryFn: () => api.problemSets({ limit: 20, offset: setsOffset }),
  });
  const dashboard = useQuery({ queryKey: ['dashboard', identity], queryFn: api.dashboard });
  const history = useQuery({
    queryKey: ['submissions', identity, submissionFilter, historyOffset],
    queryFn: () => api.submissions({ mine: true, status: SUBMISSION_STATUS[submissionFilter], limit: 8, offset: historyOffset }),
  });
  const starterPage = useQuery({
    queryKey: ['public-bundles', 'starters'],
    queryFn: () => api.publicBundles({ limit: 2, offset: 0 }),
    enabled: workspaceMode,
  });
  const continueData = useQuery({
    queryKey: ['submissions', identity, 'continue'],
    queryFn: () => api.submissions({ mine: true, limit: 20, offset: 0 }),
    enabled: workspaceMode,
  });
  const topicData = useQuery({
    queryKey: ['problems', identity, 'topic-summary'],
    queryFn: async () => {
      const firstPage = await api.problems({ limit: 100, offset: 0 });
      const remainingPages = Math.max(0, Math.ceil(firstPage.total / firstPage.limit) - 1);
      const pages = await Promise.all(Array.from({ length: remainingPages }, (_, index) => api.problems({ limit: firstPage.limit, offset: (index + 1) * firstPage.limit })));
      return [firstPage, ...pages].flatMap((page) => page.problems);
    },
    enabled: workspaceMode,
  });

  const sandbox = health.data?.sandbox;
  const ready = health.data?.status === 'ok' && sandbox?.available === true;
  const stats = dashboard.data?.stats;
  const recentSubmissions = history.data?.submissions ?? [];
  const allSubmissions = continueData.data?.submissions ?? [];
  const starterSets = starterBundles(starterPage.data?.problemSets ?? []);
  const submissionsInRecentTopics = allSubmissions.length ? allSubmissions : (dashboard.data?.recentSubmissions ?? []).map((submission) => ({ ...submission, executor: null, completedAt: null, tags: [] }));

  return (
    <div className={workspaceMode ? 'bundle-dashboard-root' : 'flex flex-col gap-[var(--space-2xl)]'}>
      {!workspaceMode ? (
        <header className="reveal" style={revealDelay(0)}>
          <h1 className="type-display">Problem sets</h1>
          <p className="type-lede measure mt-[var(--space-xs)]">
            Pick a set, write C in the editor, and the grader compiles it and runs every test case, visible and hidden.
          </p>
        </header>
      ) : null}

      {workspaceMode ? (
        <div className="bundle-dashboard">
          <header className="bundle-dashboard-heading">
            <div>
              <p className="bundle-eyebrow">YOUR LIBRARY</p>
              <h1 className="bundle-destination-title">Your Bundle{dashboard.data?.user.username ? greetingName(dashboard.data.user.username) : ''}</h1>
              <p className="bundle-destination-subtitle">Pick up where you left off, or start something new.</p>
            </div>
            <div className="bundle-dashboard-actions">
              <Link className="btn btn-quiet" to="/bundles/public">Browse public bundles</Link>
              <Link className="btn btn-primary" to="/bundles/create">Create with AI</Link>
            </div>
          </header>

          <section className="bundle-stats-grid" aria-label="Your progress">
            <article className="bundle-stat surface"><span className="bundle-stat-number">{stats ? `${stats.solvedProblems} / ${stats.attemptedProblems}` : '—'}</span><span className="bundle-stat-label">Problems solved</span>{stats?.attemptedProblems ? <div className="bundle-stat-track"><span role="img" aria-label={`${Math.round(stats.solvedProblems / stats.attemptedProblems * 100)} percent solved`} style={{ '--bundle-progress': `${Math.round(stats.solvedProblems / stats.attemptedProblems * 100)}%` } as React.CSSProperties} /></div> : null}</article>
            <article className="bundle-stat surface"><span className="bundle-stat-number">{stats?.completedSubmissions ?? '—'}</span><span className="bundle-stat-label">Submissions graded</span></article>
            <article className="bundle-stat surface"><span className="bundle-stat-number">{stats ? stats.attemptedProblems ? `${Math.round(stats.solvedProblems / stats.attemptedProblems * 100)}%` : '—' : '—'}</span><span className="bundle-stat-label">Solve rate</span></article>
            <article className="bundle-stat surface"><span className="bundle-stat-number">{stats ? stats.totalSubmissions : '—'}</span><span className="bundle-stat-label">Total submissions</span></article>
          </section>

          {continueData.isError ? <p role="status" className="type-small text-[var(--color-muted)]">Your recent problem could not be loaded.</p> : continueData.data ? <ContinueCard submissions={allSubmissions} /> : null}

          <div className="bundle-dashboard-columns">
            <div className="bundle-dashboard-main">
              <section aria-labelledby="bundle-sets-heading">
                <div className="bundle-section-heading"><h2 id="bundle-sets-heading" className="type-title">Problem sets</h2><span className="type-micro">Your private library</span></div>
                {problemSets.isLoading ? <p className="type-small text-[var(--color-muted)]">Loading problem sets…</p> : problemSets.isError ? <p className="type-small text-[var(--color-fail)]">Problem sets could not be loaded: {(problemSets.error as Error).message}</p> : <ProblemSetSelector problemSets={problemSets.data?.problemSets ?? []} />}
                {problemSets.data ? <Pagination total={problemSets.data.total} limit={problemSets.data.limit} offset={problemSets.data.offset} onPageChange={setSetsOffset} label="problem sets" /> : null}
              </section>

              <section className="bundle-dashboard-starters" aria-labelledby="starter-heading">
                <div className="bundle-section-heading"><h2 id="starter-heading" className="type-title">Popular to start with</h2><Link to="/bundles/public" className="link">Browse all</Link></div>
                {starterPage.isLoading ? <p className="type-small text-[var(--color-muted)]">Finding public sets…</p> : null}
                {starterPage.isError ? <p className="type-small text-[var(--color-fail)]">Starter sets could not be loaded.</p> : null}
                {starterSets.length ? <ul className="bundle-starter-grid">{starterSets.map((bundle) => <li key={bundle.id}><Link to="/bundles/public" className="bundle-starter surface"><span className="font-[var(--weight-strong)]">{bundle.title}</span><span className="type-micro">{bundle.problemCount} problems · {bundle.difficulty}</span>{bundle.description ? <span className="type-small text-[var(--color-muted)]">{bundle.description}</span> : null}</Link></li>)}</ul> : !starterPage.isLoading && !starterPage.isError ? <p className="type-small text-[var(--color-muted)]">No public starter sets yet. Create one and share it with the community.</p> : null}
              </section>

              <section aria-labelledby="recent-heading">
                <div className="bundle-section-heading"><h2 id="recent-heading" className="type-title">Recent submissions</h2></div>
                <div className="bundle-filter-row" role="group" aria-label="Filter submissions">
                  {(['all', 'passed', 'failed'] as const).map((filter) => <button key={filter} type="button" className="bundle-filter" aria-pressed={submissionFilter === filter} onClick={() => { setSubmissionFilter(filter); setHistoryOffset(0); }}>{filter.charAt(0).toUpperCase() + filter.slice(1)}</button>)}
                </div>
                {history.isLoading ? <p className="type-small text-[var(--color-muted)]">Loading submissions…</p> : history.isError ? <p role="alert" className="type-small text-[var(--color-fail)]">Could not load submissions: {(history.error as Error).message}</p> : recentSubmissions.length ? <div className="bundle-history-surface surface"><ul className="bundle-history-list">{recentSubmissions.map((submission) => {
                  const result = outcome(submission);
                  return <li key={submission.id} className="bundle-history-row"><Link to={`/problems/${submission.problemId}`} className="bundle-history-link"><span className="bundle-history-title">{submission.problemTitle}</span><span className="type-micro">{formatDateTime(submission.createdAt)}</span></Link><div className="bundle-history-result"><span className={`bundle-outcome bundle-outcome--${result.kind}`}>{result.label}</span><span className="num type-small">{submission.passedCount} / {submission.totalCount}</span></div></li>;
                })}</ul></div> : <p className="type-small text-[var(--color-muted)]">No {submissionFilter === 'all' ? '' : `${submissionFilter} `}submissions yet.</p>}
                {history.data && history.data.total > history.data.limit && <Pagination total={history.data.total} limit={history.data.limit} offset={history.data.offset} onPageChange={setHistoryOffset} label="submissions" />}
              </section>
            </div>

            <aside className="bundle-dashboard-sidebar" aria-label="Practice insights">
              <WeeklyActivity submissions={allSubmissions} loading={continueData.isLoading || continueData.isError} />
              {topicData.isError ? <section className="bundle-side-card surface"><h2 className="type-title">Recent topics</h2><p className="type-small mt-2 text-[var(--color-muted)]">Topic insights are temporarily unavailable.</p></section> : <TopicSummary submissions={submissionsInRecentTopics} problems={topicData.data ?? []} loading={topicData.isLoading || continueData.isLoading || dashboard.isLoading} />}
              <section className="bundle-side-card surface" aria-labelledby="grader-heading">
                <div className="bundle-grader-status"><h2 id="grader-heading" className="type-title">Grader status</h2><p className="bundle-status-line"><span className={`bundle-status-dot ${ready ? 'bundle-status-dot--ready' : ''}`} />{health.isLoading ? 'Checking…' : ready ? 'Ready to grade' : 'Grading unavailable'}</p></div>
                {!health.isLoading && !ready && sandbox?.detail ? <p className="type-micro mt-2">{sandbox.detail}</p> : null}
              </section>
            </aside>
          </div>
        </div>
      ) : null}

      {!workspaceMode ? <div className="grid gap-[var(--space-2xl)] lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:gap-[var(--space-xl)]">
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
          {problemSets.data ? (
            <Pagination
              total={problemSets.data.total}
              limit={problemSets.data.limit}
              offset={problemSets.data.offset}
              onPageChange={setSetsOffset}
              label="problem sets"
            />
          ) : null}
        </section>

        <aside className="reveal flex min-w-0 flex-col gap-[var(--space-xl)]" style={revealDelay(2)}>
          <section className="surface p-[var(--space-lg)]" aria-labelledby="progress-heading">
            <h2 id="progress-heading" className="type-title">
              {guest ? 'Guest progress' : 'Your progress'}
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
              <>
                <SubmissionHistory submissions={history.data?.submissions ?? []} />
                {history.data ? (
                  <Pagination
                    total={history.data.total}
                    limit={history.data.limit}
                    offset={history.data.offset}
                    onPageChange={setHistoryOffset}
                    label="submissions"
                  />
                ) : null}
              </>
            )}
          </section>
        </aside>
      </div> : null}
    </div>
  );
}
