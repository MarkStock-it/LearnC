import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, getQueryIdentity, type ProblemSetSummary } from '../../services/api';
import { revealDelay } from '../../lib/reveal';

/**
 * The set index is a ledger, not a card grid: one column, hairline-separated rows,
 * title first, metadata on a second line. Rows scan in a single vertical sweep.
 */
export function ProblemSetSelector({ problemSets }: { problemSets: ProblemSetSummary[] }) {
  const queryClient = useQueryClient();
  const identity = getQueryIdentity();
  const [message, setMessage] = useState<string | null>(null);
  const publish = useMutation({
    mutationFn: ({ id, isPublic }: { id: number; isPublic: boolean }) => api.publishBundle(id, isPublic),
    onSuccess: (_result, variables) => {
      setMessage(variables.isPublic ? 'Bundle published to the community library.' : 'Bundle is private again.');
      void queryClient.invalidateQueries({ queryKey: ['problemSets', identity] });
    },
    onError: (error) => setMessage((error as Error).message),
  });

  if (problemSets.length === 0) {
    return (
      <div className="bundle-empty-state surface">
        <span className="bundle-empty-mark" aria-hidden="true">+</span>
        <h3 className="type-title">Build your first set</h3>
        <p className="type-small mt-1 text-[var(--color-muted)]">
          Tell the AI what you want to practice and make a focused set, or explore activities shared by the community.
        </p>
        <div className="bundle-empty-actions">
          <Link to="/bundles/create" className="btn btn-primary">Create with AI</Link>
          <Link to="/bundles/public" className="btn btn-quiet">Browse public bundles</Link>
        </div>
      </div>
    );
  }

  return (
    <>
      <ul className="surface overflow-hidden">
        {problemSets.map((problemSet, index) => (
          <li
            key={problemSet.id}
            className={`a-row bundle-set-row ${index === 0 ? '' : 'bundle-set-row--divided'}`}
            style={revealDelay(index)}
          >
            <Link to={`/sets/${problemSet.id}`} className="bundle-set-link row-hover">
              <span className="row-title block text-[var(--text-body)] font-[var(--weight-strong)] text-[var(--color-ink)]">
                {problemSet.title}
              </span>
              {problemSet.description ? <span className="type-small mt-0.5 block text-[var(--color-muted)]">{problemSet.description}</span> : null}
              <span className="type-micro mt-1 flex flex-wrap items-center gap-3">
                <span>{problemSet.examYear ? `${problemSet.examSemester ?? ''} ${problemSet.examYear}`.trim() : problemSet.difficulty}</span>
                <span>{problemSet.problemCount} {problemSet.problemCount === 1 ? 'problem' : 'problems'}</span>
                {problemSet.isPublic ? <span className="text-[var(--color-accent)]">Published</span> : null}
              </span>
            </Link>
            {api.isAuthenticated() ? (
              <button
                type="button"
                className="btn shrink-0"
                disabled={publish.isPending}
                onClick={() => publish.mutate({ id: problemSet.id, isPublic: !problemSet.isPublic })}
                aria-label={`${problemSet.isPublic ? 'Unpublish' : 'Publish'} ${problemSet.title}`}
              >
                {publish.isPending && publish.variables?.id === problemSet.id
                  ? 'Saving…'
                  : problemSet.isPublic ? 'Unpublish' : 'Publish'}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {message ? <p role="status" className="a-toast type-small mt-2">{message}</p> : null}
    </>
  );
}
