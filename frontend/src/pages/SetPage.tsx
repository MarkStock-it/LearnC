import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api, getQueryIdentity } from '../services/api';
import { StatusMark } from '../components/ui/StatusMark';
import { revealDelay } from '../lib/reveal';
import { Pagination } from '../components/ui/Pagination';

export function SetPage() {
  const { setId } = useParams();
  const id = Number(setId);
  const identity = getQueryIdentity();
  const [problemsOffset, setProblemsOffset] = useState(0);

  const set = useQuery({
    queryKey: ['problemSet', identity, id],
    queryFn: () => api.problemSet(id),
    enabled: Number.isFinite(id),
  });
  const problems = useQuery({
    queryKey: ['problems', identity, id, problemsOffset],
    queryFn: () => api.problems({ problemSetId: id, limit: 30, offset: problemsOffset }),
    enabled: Number.isFinite(id),
  });
  const dashboard = useQuery({ queryKey: ['dashboard', identity], queryFn: api.dashboard });

  const problemSet = set.data?.problemSet;
  const solvedIds = new Set(dashboard.data?.stats.solvedProblemIds ?? []);
  const entries = problems.data?.problems ?? [];
  const solvedCount = entries.filter((problem) => solvedIds.has(problem.id)).length;

  /* Only once the set list has actually arrived: before that, an unknown id is just
   * a set we have not heard about yet. Without this the page fell through to a
   * generic "Problem set" heading over an empty body. */
  const missing = set.isError && (set.error as { status?: number })?.status === 404;

  return (
    <div className="flex flex-col gap-[var(--space-xl)]">
      <nav aria-label="Breadcrumb" className="type-micro reveal" style={revealDelay(0)}>
        <Link to="/bundles/your" className="link">
          Problem sets
        </Link>
        <span className="mx-1.5">/</span>
        <span className="text-[var(--color-muted)]">{problemSet?.title ?? `Set ${setId}`}</span>
      </nav>

      {missing ? (
        <section className="surface reveal p-[var(--space-lg)]" style={revealDelay(1)}>
          <h1 className="type-title">That problem set doesn’t exist</h1>
          <p className="type-small measure mt-[var(--space-2xs)] text-[var(--color-muted)]">
            Nothing is filed under “{setId}”. The link may be mistyped, or the set may have been
            removed.
          </p>
          <Link to="/" className="link mt-[var(--space-sm)] inline-block text-[var(--text-small)]">
            Back to problem sets
          </Link>
        </section>
      ) : set.isError ? (
        <p role="alert" className="type-small text-[var(--color-fail)]">Could not load this problem set: {(set.error as Error).message}</p>
      ) : (
        <>
          <header className="reveal" style={revealDelay(1)}>
            <h1 className="type-display">{problemSet?.title ?? 'Problem set'}</h1>
            {problemSet?.description ? (
              <p className="type-lede measure mt-[var(--space-xs)]">{problemSet.description}</p>
            ) : null}
            {/* Progress stacks below the title rather than beside it (gate 54). */}
            {entries.length > 0 ? (
              <p className="num type-small mt-[var(--space-sm)] text-[var(--color-muted)]">
                {solvedCount} of {entries.length} on this page solved · {problems.data?.total ?? problemSet?.problemCount ?? 0} total problems
              </p>
            ) : null}
          </header>

          {problems.isLoading ? (
            <p className="type-small text-[var(--color-muted)]">Loading problems…</p>
          ) : null}

          {problems.isError ? (
            <p className="type-small text-[var(--color-fail)]">
              Problems could not be loaded: {(problems.error as Error).message}
            </p>
          ) : null}

          {problems.isSuccess && problems.data.total === 0 ? (
            <p className="type-small text-[var(--color-muted)]">
              This set has no problems yet.
            </p>
          ) : null}

          {entries.length > 0 ? (
            <ul className="surface reveal overflow-hidden" style={revealDelay(2)}>
              {entries.map((problem, index) => {
                const solved = solvedIds.has(problem.id);
                return (
                  <li key={problem.id} className={index === 0 ? '' : 'border-t border-[var(--color-rule)]'}>
                    <Link
                      to={`/problems/${problem.id}`}
                      className="row-hover flex flex-wrap items-baseline gap-x-4 gap-y-1 px-5 py-4"
                    >
                      <span className="flex min-w-0 items-baseline gap-2">
                        {solved ? (
                          <span className="verdict-pass translate-y-[1px]">
                            <StatusMark kind="pass" />
                          </span>
                        ) : null}
                        <span className="row-title text-[var(--text-body)] font-[var(--weight-strong)] text-[var(--color-ink)]">
                          {problem.title}
                        </span>
                      </span>

                      <span className="type-micro">{problem.difficulty}</span>

                      <span className="ms-auto flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        {problem.tags.map((tag) => (
                          <span key={tag} className="tag">
                            {tag}
                          </span>
                        ))}
                        <span className="num type-micro">{problem.testCaseCount} cases</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : null}
          {problems.data ? (
            <Pagination
              total={problems.data.total}
              limit={problems.data.limit}
              offset={problems.data.offset}
              onPageChange={setProblemsOffset}
              label="problems"
            />
          ) : null}
        </>
      )}
    </div>
  );
}
