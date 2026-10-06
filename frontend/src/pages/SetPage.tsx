import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api, getQueryIdentity } from '../services/api';
import { StatusMark } from '../components/ui/StatusMark';
import { revealDelay } from '../lib/reveal';
import { Pagination } from '../components/ui/Pagination';

/**
 * One problem set, as a listing.
 *
 * The problems are the page, so they are set as a numbered listing: the rail carries
 * the line number, the body carries the title, and a solved problem is marked with the
 * pass stamp rather than by tinting the whole row. The status bar reports what is
 * actually true about this page — how many of these problems are solved, and which
 * page of the set you are on.
 */
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

  const total = problems.data?.total ?? problemSet?.problemCount ?? 0;
  const page = problems.data ? Math.floor(problems.data.offset / problems.data.limit) + 1 : 1;
  const pageCount = problems.data ? Math.max(1, Math.ceil(problems.data.total / problems.data.limit)) : 1;

  /* Only once the set list has actually arrived: before that, an unknown id is just
   * a set we have not heard about yet. Without this the page fell through to a
   * generic "Problem set" heading over an empty body. */
  const missing = set.isError && (set.error as { status?: number })?.status === 404;

  return (
    <div className="flex flex-col gap-[var(--space-xl)]">
      <nav aria-label="Breadcrumb" className="type-micro a-compile">
        <Link to="/bundles/your" className="link">
          Problem sets
        </Link>
        <span className="mx-1.5">/</span>
        <span className="text-[var(--color-muted)]">{problemSet?.title ?? `Set ${setId}`}</span>
      </nav>

      {missing ? (
        <section className="surface a-compile p-[var(--space-lg)]">
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
        <p role="alert" className="a-diag type-small border-s-2 border-[var(--color-fail)] ps-3 text-[var(--color-fail)]">
          Could not load this problem set: {(set.error as Error).message}
        </p>
      ) : (
        <>
          <header className="a-compile">
            <h1 className="type-display">{problemSet?.title ?? 'Problem set'}</h1>
            {problemSet?.description ? (
              <p className="type-lede measure mt-[var(--space-xs)]">{problemSet.description}</p>
            ) : null}
            {/* Progress stacks below the title rather than beside it (gate 54). */}
            {entries.length > 0 ? (
              <p className="num type-small mt-[var(--space-sm)] text-[var(--color-muted)]">
                {solvedCount} of {entries.length} on this page solved · {total} total problems
              </p>
            ) : null}
          </header>

          {problems.isLoading ? (
            <p className="type-small flex items-center gap-2 text-[var(--color-muted)]">
              <span className="a-blocks" aria-hidden="true">
                <i />
                <i />
                <i />
                <i />
              </span>
              Loading problems…
            </p>
          ) : null}

          {problems.isError ? (
            <p role="alert" className="a-diag type-small border-s-2 border-[var(--color-fail)] ps-3 text-[var(--color-fail)]">
              Problems could not be loaded: {(problems.error as Error).message}
            </p>
          ) : null}

          {problems.isSuccess && problems.data.total === 0 ? (
            <p className="type-small text-[var(--color-muted)]">This set has no problems yet.</p>
          ) : null}

          {/* The rail numbers the problems, so the title does not have to carry a
           * position. `role="list"` keeps the list semantics the `<ul>` had. */}
          {entries.length > 0 ? (
            <div className="gutter a-compile" role="list" aria-label="Problems in this set">
              {entries.map((problem, index) => {
                const solved = solvedIds.has(problem.id);
                return (
                  <div
                    key={problem.id}
                    className="gutter-row a-line"
                    role="listitem"
                    style={revealDelay(index)}
                  >
                    <span className="gutter-ln" aria-hidden="true">
                      {index + 1}
                    </span>
                    <div className="gutter-body">
                      <Link
                        to={`/problems/${problem.id}`}
                        className="row-hover flex flex-wrap items-baseline gap-x-4 gap-y-1"
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
                    </div>
                  </div>
                );
              })}
            </div>
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

      <div className="statusbar">
        <span className="statusbar-item" data-strength="strong">
          {problemSet?.title ?? `Set ${setId}`}
        </span>
        <span className="statusbar-item">{total} problems</span>
        <span className="statusbar-item">{solvedCount} solved on this page</span>
        <span className="statusbar-spacer" />
        <span
          className="statusbar-state"
          data-state={problems.isError ? 'error' : problems.isLoading ? 'run' : 'ok'}
        >
          {problems.isError
            ? 'load failed'
            : problems.isLoading
              ? 'reading'
              : `page ${page} of ${pageCount}`}
        </span>
      </div>
    </div>
  );
}
