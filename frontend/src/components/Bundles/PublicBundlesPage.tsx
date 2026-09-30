import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Pagination } from '../ui/Pagination';
import { api, type Difficulty, type ProblemSetSummary } from '../../services/api';

export function PublicBundlesPage() {
  const [search, setSearch] = useState('');
  const [difficulty, setDifficulty] = useState<Difficulty | ''>('');
  const [topic, setTopic] = useState('');
  const [selected, setSelected] = useState<number | null>(null);
  const [detailOffset, setDetailOffset] = useState(0);
  const [offset, setOffset] = useState(0);
  const [leaderboardOffset, setLeaderboardOffset] = useState(0);
  const filters = useMemo(() => ({ search: search.trim() || undefined, difficulty: difficulty || undefined, tag: topic.trim() || undefined }), [search, difficulty, topic]);
  const bundlePage = useQuery({ queryKey: ['public-bundles', filters, offset], queryFn: () => api.publicBundles({ ...filters, limit: 20, offset }) });
  const bundles = bundlePage.data;
  const leaderboard = useQuery({ queryKey: ['leaderboard', leaderboardOffset], queryFn: () => api.leaderboard({ limit: 10, offset: leaderboardOffset }) });
  const detail = useQuery({ queryKey: ['public-bundle', selected, detailOffset], queryFn: () => api.publicBundle(selected!, { limit: 30, offset: detailOffset }), enabled: selected !== null });
  const [forking, setForking] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const fork = async (bundle: ProblemSetSummary) => {
    if (!api.isAuthenticated()) {
      setMessage('Sign in to fork a community bundle into your private library.');
      return;
    }
    setForking(bundle.id);
    setMessage(null);
    try {
      const result = await api.forkBundle(bundle.id);
      setMessage('Bundle copied to your private library.');
      window.location.assign(`/sets/${result.problemSetId}`);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setForking(null);
    }
  };

  return (
    <div className="bundle-destination-copy">
      <div className="bundle-destination-heading-row"><div>
        <p className="bundle-eyebrow">COMMUNITY LIBRARY</p>
        <h1 className="bundle-destination-title">Public Bundles</h1>
        <p className="bundle-destination-subtitle">Activities deliberately shared by their creators.</p>
      </div></div>
      <section className="surface mb-5 p-4" aria-labelledby="public-leaderboard-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div><p className="bundle-eyebrow">COMMUNITY</p><h2 id="public-leaderboard-heading" className="type-title">Leaderboard</h2></div>
          {leaderboard.data ? <span className="type-micro">Opt-in · {leaderboard.data.total} participants</span> : null}
        </div>
        {leaderboard.isLoading ? <p className="type-small mt-3">Loading leaderboard…</p> : null}
        {leaderboard.isError ? <p role="alert" className="type-small mt-3 text-[var(--color-fail)]">Could not load leaderboard: {(leaderboard.error as Error).message}</p> : null}
        {leaderboard.data?.entries.length === 0 ? <p className="type-small mt-3 text-[var(--color-muted)]">No one has opted into the leaderboard yet. You can enable public participation in your account settings.</p> : null}
        {leaderboard.data && leaderboard.data.entries.length > 0 ? <ol className="mt-3 divide-y divide-[var(--color-rule)]">{leaderboard.data.entries.map((entry) => <li key={entry.rank} className="flex items-center justify-between gap-3 py-2"><span className="type-small"><span className="num me-3 text-[var(--color-faint)]">#{entry.rank}</span>{entry.username}</span><span className="num type-small">{entry.solvedProblems} solved</span></li>)}</ol> : null}
        {leaderboard.data ? <Pagination total={leaderboard.data.total} limit={leaderboard.data.limit} offset={leaderboard.data.offset} onPageChange={setLeaderboardOffset} label="participants" /> : null}
      </section>
      <div className="flex flex-wrap gap-2 py-4">
        <input aria-label="Search public bundles" className="field min-w-48 flex-1" placeholder="Search title or description" value={search} onChange={(event) => { setSearch(event.target.value); setOffset(0); }} />
        <select aria-label="Filter by difficulty" className="field" value={difficulty} onChange={(event) => { setDifficulty(event.target.value as Difficulty | ''); setOffset(0); }}>
          <option value="">All difficulty</option><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option>
        </select>
        <input aria-label="Filter by topic" className="field w-40" placeholder="Topic tag" value={topic} onChange={(event) => { setTopic(event.target.value); setOffset(0); }} />
      </div>
      {bundlePage.isLoading ? <p className="type-small">Loading community bundles…</p> : null}
      {bundlePage.isError ? <p role="alert" className="type-small text-[var(--color-fail)]">Could not load public bundles: {(bundlePage.error as Error).message}</p> : null}
      {bundlePage.isSuccess && bundles?.problemSets.length === 0 ? <p className="bundle-empty-state">No public bundles match those filters yet.</p> : null}
      <ul className="flex flex-col gap-3">
        {bundles?.problemSets.map((bundle) => <li key={bundle.id} className="surface flex flex-wrap items-center justify-between gap-3 p-4">
          <button type="button" className="min-w-0 flex-1 text-start" onClick={() => { setDetailOffset(0); setSelected(bundle.id); }}>
            <span className="type-title block">{bundle.title}</span>
            <span className="type-micro block mt-1">{bundle.difficulty} · {bundle.problemCount} problems · by {bundle.creatorName ?? 'Community member'} · {bundle.publishedAt ? new Date(bundle.publishedAt).toLocaleDateString() : 'Published'}</span>
            {bundle.description ? <span className="type-small block mt-1 text-[var(--color-muted)]">{bundle.description}</span> : null}
          </button>
          <button type="button" className="btn btn-quiet" onClick={() => { setDetailOffset(0); setSelected(bundle.id); }}>Preview</button>
          <button type="button" className="btn btn-primary" disabled={forking === bundle.id} onClick={() => void fork(bundle)}>{forking === bundle.id ? 'Copying…' : 'Use this'}</button>
        </li>)}
      </ul>
      {bundles ? <Pagination total={bundles.total} limit={bundles.limit} offset={bundles.offset} onPageChange={setOffset} label="public bundles" /> : null}
      {message ? <p role="status" className="type-small mt-3">{message} {!api.isAuthenticated() ? <Link to="/login" className="link">Sign in</Link> : null}</p> : null}
      {selected !== null ? <div className="fixed inset-0 z-[var(--z-modal)] flex justify-end bg-black/50" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
        <aside className="h-full w-full max-w-xl overflow-y-auto bg-[var(--color-surface)] p-6 shadow-2xl" role="dialog" aria-modal="true" aria-label="Public bundle preview">
          <div className="flex items-start justify-between gap-4"><div><p className="bundle-eyebrow">PUBLIC BUNDLE PREVIEW</p><h2 className="type-title mt-2">{detail.data?.problemSet.title ?? 'Loading bundle…'}</h2></div><button type="button" className="btn btn-quiet" onClick={() => setSelected(null)}>Close</button></div>
          {detail.isError ? <p role="alert" className="type-small mt-3 text-[var(--color-fail)]">Could not load this bundle: {(detail.error as Error).message}</p> : null}
          {detail.isLoading ? <p className="type-small mt-3">Loading problems…</p> : null}
          {detail.data?.problemSet.description ? <p className="type-small mt-3">{detail.data.problemSet.description}</p> : null}
          <ul className="mt-5 divide-y divide-[var(--color-rule)]">{detail.data?.problems.map((problem) => <li key={problem.id} className="py-3"><Link className="link" to={`/problems/${problem.id}`}>{problem.title}</Link><p className="type-micro mt-1">{problem.difficulty} · {problem.tags.join(', ')}</p></li>)}</ul>
          {detail.data ? <Pagination total={detail.data.totalProblems} limit={detail.data.limit} offset={detail.data.offset} onPageChange={setDetailOffset} label="problems" /> : null}
          {detail.data?.problems[0] ? <Link className="btn btn-quiet mt-4 inline-flex" to={`/problems/${detail.data.problems[0].id}`}>Practice first problem</Link> : null}
          {detail.data ? <button type="button" className="btn btn-primary ms-2 mt-4" onClick={() => void fork(detail.data!.problemSet)}>Fork to my library</button> : null}
        </aside>
      </div> : null}
    </div>
  );
}
