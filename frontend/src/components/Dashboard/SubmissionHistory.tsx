import { Link } from 'react-router-dom';
import type { SubmissionSummary } from '../../services/api';
import { formatDateTime, formatRatio } from '../../lib/format';
import { StatusMark, type MarkKind } from '../ui/StatusMark';

function markFor(status: string, passed: number, total: number): MarkKind {
  if (status === 'FAILED') return 'crash';
  if (status !== 'COMPLETED') return 'pending';
  if (total > 0 && passed === total) return 'pass';
  return 'wrong';
}

const MARK_CLASS: Record<MarkKind, string> = {
  pass: 'verdict-pass',
  wrong: 'verdict-fail',
  timeout: 'verdict-warn',
  crash: 'verdict-fail',
  pending: 'text-[var(--color-faint)]',
};

export function SubmissionHistory({ submissions }: { submissions: SubmissionSummary[] }) {
  if (submissions.length === 0) {
    return (
      <p className="type-small text-[var(--color-muted)]">
        Nothing submitted yet. Open a set, write your solution, and it will show up here.
      </p>
    );
  }

  return (
    <table className="data-table">
      <caption className="sr-only">Your recent submissions</caption>
      <thead>
        <tr>
          <th scope="col">Problem</th>
          <th scope="col" className="w-20">
            Passed
          </th>
          <th scope="col" className="w-28">
            Status
          </th>
          <th scope="col" className="w-32">
            Submitted
          </th>
        </tr>
      </thead>
      <tbody>
        {submissions.map((submission) => {
          const mark = markFor(submission.status, submission.passedCount, submission.totalCount);
          return (
            <tr key={submission.id}>
              <td>
                <Link to={`/problems/${submission.problemId}`} className="link">
                  {submission.problemTitle}
                </Link>
              </td>
              <td className="num text-[var(--color-muted)]">
                {formatRatio(submission.passedCount, submission.totalCount)}
              </td>
              <td>
                <span className={`inline-flex items-center gap-1.5 ${MARK_CLASS[mark]}`}>
                  <StatusMark kind={mark} />
                  <span className="type-small">{submission.status === 'COMPLETED' ? 'Graded' : submission.status === 'FAILED' ? 'Grader error' : 'Running'}</span>
                </span>
              </td>
              <td className="num type-small text-[var(--color-faint)]">{formatDateTime(submission.createdAt)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
