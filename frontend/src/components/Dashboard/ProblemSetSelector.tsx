import { Link } from 'react-router-dom';
import type { ProblemSetSummary } from '../../services/api';

/**
 * The set index is a ledger, not a card grid: one column, hairline-separated rows,
 * title first, metadata on a second line. Rows scan in a single vertical sweep, and
 * the page avoids the identical-rounded-card rhythm that reads as generated.
 */
export function ProblemSetSelector({ problemSets }: { problemSets: ProblemSetSummary[] }) {
  if (problemSets.length === 0) {
    return (
      <div className="surface p-6">
        <h3 className="type-title">No problem sets yet</h3>
        <p className="type-small mt-1 text-[var(--color-muted)]">
          Load the sample exam bundles from the backend with{' '}
          <code className="mono rounded-[var(--radius-micro)] bg-[var(--color-surface-2)] px-1">npm run db:seed</code>.
        </p>
      </div>
    );
  }

  return (
    <ul className="surface overflow-hidden">
      {problemSets.map((problemSet, index) => (
        <li key={problemSet.id} className={index === 0 ? '' : 'border-t border-[var(--color-rule)]'}>
          <Link
            to={`/sets/${problemSet.id}`}
            className="row-hover flex items-baseline gap-4 px-5 py-4"
          >
            <span className="min-w-0 flex-1">
              <span className="row-title block text-[var(--text-body)] font-[var(--weight-strong)] text-[var(--color-ink)]">
                {problemSet.title}
              </span>
              {problemSet.description ? (
                <span className="type-small mt-0.5 block text-[var(--color-muted)]">{problemSet.description}</span>
              ) : null}
            </span>

            <span className="type-micro hidden shrink-0 sm:block">
              {problemSet.examYear ? `${problemSet.examSemester ?? ''} ${problemSet.examYear}`.trim() : problemSet.difficulty}
            </span>

            <span className="num shrink-0 text-[var(--text-small)] text-[var(--color-muted)]">
              {problemSet.problemCount} {problemSet.problemCount === 1 ? 'problem' : 'problems'}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
