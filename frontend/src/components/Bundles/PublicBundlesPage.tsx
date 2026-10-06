import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Pagination } from '../ui/Pagination';
import { revealDelay } from '../../lib/reveal';
import { api, type Difficulty, type ProblemSetSummary } from '../../services/api';

/**
 * The community library, as listings.
 *
 * Everything on this page that is genuinely a list wears the rail: the leaderboard is
 * numbered by rank, the bundles by position, and a bundle's problems by position. The
 * signal colour is spent once per view, and the view that gets it is the preview panel
 * you deliberately opened — the row itself is quiet, because a page of twenty rows each
 * shouting in vermilion would spend the accent on all of them and mean nothing by it.
 */
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
  /**
   * The preview is a native `<dialog>` opened with `showModal()`. That is what actually
   * provides focus containment, Escape-to-close, an inert background and focus restored
   * to the invoking control — all of which the previous `role="dialog" aria-modal` markup
   * asserted and none of which it implemented, so assistive tech was told the rest of the
   * page was unavailable while Tab walked straight through it.
   */
  const drawerRef = useRef<HTMLDialogElement>(null);
  /**
   * Where focus came from. A modal dialog restores it on close, but React unmounts this
   * one at the same moment, which skips that step and drops focus onto the page container
   * — so a keyboard user who opened a bundle lands back at the top of the document.
   */
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const drawer = drawerRef.current;
    if (selected !== null) {
      // Guarded because moving from one bundle to the next keeps the element mounted.
      if (drawer && !drawer.open) drawer.showModal();
      return;
    }
    // Deferred to the next task on purpose. The browser restores focus for a closed modal
    // dialog *after* the `close` event, so a synchronous restore here is overwritten by it
    // — measured, before this line existed: focus ended up on the workspace destination
    // button behind the page rather than the control that opened the panel.
    const timer = window.setTimeout(() => restoreFocusRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [selected]);
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

  const activeFilters = [search.trim() && `“${search.trim()}”`, difficulty, topic.trim()].filter(Boolean) as string[];

  return (
    <div className="bundle-destination-copy">
      <div className="bundle-destination-heading-row"><div className="a-compile">
        <p className="bundle-eyebrow">{'/* community library */'}</p>
        <h1 className="bundle-destination-title">Public Bundles</h1>
        <p className="bundle-destination-subtitle">Activities deliberately shared by their creators.</p>
      </div></div>

      <section className="surface a-compile mb-5 p-4" aria-labelledby="public-leaderboard-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div><p className="bundle-eyebrow">{'/* community */'}</p><h2 id="public-leaderboard-heading" className="type-title">Leaderboard</h2></div>
          {leaderboard.data ? <span className="type-micro">Opt-in · {leaderboard.data.total} participants</span> : null}
        </div>
        {leaderboard.isLoading ? (
          <p className="type-small mt-3 flex items-center gap-2">
            <span className="a-blocks" aria-hidden="true"><i /><i /><i /><i /></span>
            Loading leaderboard…
          </p>
        ) : null}
        {leaderboard.isError ? <p role="alert" className="a-diag type-small mt-3 border-s-2 border-[var(--color-fail)] ps-3 text-[var(--color-fail)]">Could not load leaderboard: {(leaderboard.error as Error).message}</p> : null}
        {leaderboard.data?.entries.length === 0 ? <p className="type-small mt-3 text-[var(--color-muted)]">No one has opted into the leaderboard yet. You can enable public participation in your account settings.</p> : null}
        {/* The rail number IS the rank here, which is why this list adopts it. */}
        {leaderboard.data && leaderboard.data.entries.length > 0 ? (
          <div className="gutter mt-3" role="list" aria-label="Leaderboard">
            {leaderboard.data.entries.map((entry, index) => (
              <div key={entry.rank} className="gutter-row a-line" role="listitem" style={revealDelay(index)}>
                <span className="gutter-ln" aria-hidden="true">{entry.rank}</span>
                <div className="gutter-body flex items-center justify-between gap-3">
                  <span className="type-small">{entry.username}</span>
                  <span className="num type-small">{entry.solvedProblems} solved</span>
                </div>
              </div>
            ))}
          </div>
        ) : null}
        {leaderboard.data ? <Pagination total={leaderboard.data.total} limit={leaderboard.data.limit} offset={leaderboard.data.offset} onPageChange={setLeaderboardOffset} label="participants" /> : null}
      </section>

      <div className="flex flex-wrap gap-2 py-4">
        <input aria-label="Search public bundles" className="field min-w-48 flex-1" placeholder="Search title or description" value={search} onChange={(event) => { setSearch(event.target.value); setOffset(0); }} />
        <select aria-label="Filter by difficulty" className="field" value={difficulty} onChange={(event) => { setDifficulty(event.target.value as Difficulty | ''); setOffset(0); }}>
          <option value="">All difficulty</option><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option>
        </select>
        <input aria-label="Filter by topic" className="field w-40" placeholder="Topic tag" value={topic} onChange={(event) => { setTopic(event.target.value); setOffset(0); }} />
      </div>

      {/* A rail that sweeps only while a request is genuinely in flight. */}
      {bundlePage.isFetching ? <div className="a-scan mb-4" role="presentation" /> : null}

      {bundlePage.isError ? <p role="alert" className="a-diag type-small border-s-2 border-[var(--color-fail)] ps-3 text-[var(--color-fail)]">Could not load public bundles: {(bundlePage.error as Error).message}</p> : null}
      {bundlePage.isSuccess && bundles?.problemSets.length === 0 ? <p className="bundle-empty-state">No public bundles match those filters yet.</p> : null}

      {bundles && bundles.problemSets.length > 0 ? (
        <div className="gutter" role="list" aria-label="Public bundles">
          {bundles.problemSets.map((bundle, index) => (
            <div key={bundle.id} className="gutter-row a-line" role="listitem" style={revealDelay(index)}>
              <span className="gutter-ln" aria-hidden="true">{bundles.offset + index + 1}</span>
              <div className="gutter-body flex flex-wrap items-center justify-between gap-3">
                {/* The row is content, not a control: a whole-title button made the title,
                 * the metadata and the description into one long accessible name, and then a
                 * `Preview` button beside it repeated the identical action. One explicit
                 * control per action, and the row reads as a sentence of real facts. */}
                <div className="min-w-0 flex-1">
                  <span className="type-title block">{bundle.title}</span>
                  <span className="type-micro block mt-1">{bundle.difficulty} · {bundle.problemCount} problems · by {bundle.creatorName ?? 'Community member'} · {bundle.publishedAt ? new Date(bundle.publishedAt).toLocaleDateString() : 'Published'}</span>
                  {bundle.description ? <span className="type-small block mt-1 text-[var(--color-muted)]">{bundle.description}</span> : null}
                </div>
                <button type="button" className="btn btn-quiet" onClick={(event) => { restoreFocusRef.current = event.currentTarget; setDetailOffset(0); setSelected(bundle.id); }}>Preview</button>
                <button type="button" className="btn btn-quiet" disabled={forking === bundle.id} onClick={() => void fork(bundle)}>{forking === bundle.id ? 'Copying…' : 'Use this'}</button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {bundles ? <Pagination total={bundles.total} limit={bundles.limit} offset={bundles.offset} onPageChange={setOffset} label="public bundles" /> : null}

      {message ? <p role="status" className="a-toast type-small mt-3">{message} {!api.isAuthenticated() ? <Link to="/login" className="link">Sign in</Link> : null}</p> : null}

      {/* A click whose target is the dialog itself is a click on the backdrop: the
       * panel inside it covers the whole dialog box. */}
      {selected !== null ? (
        <dialog
          ref={drawerRef}
          className="bundle-sheet"
          aria-label="Public bundle preview"
          onClose={() => setSelected(null)}
          onClick={(event) => { if (event.target === event.currentTarget) drawerRef.current?.close(); }}
        >
          {/* A panel is separated by a hairline and a step of lightness — never by a
           * cast shadow. */}
          <div className="h-full w-full overflow-y-auto border-s border-[var(--color-rule)] bg-[var(--color-surface)] p-6">
            <div className="flex items-start justify-between gap-4"><div><p className="bundle-eyebrow">{'/* preview */'}</p><h2 className="type-title mt-2">{detail.data?.problemSet.title ?? 'Loading bundle…'}</h2></div><button type="button" className="btn btn-quiet" onClick={() => drawerRef.current?.close()}>Close</button></div>
            {detail.isError ? <p role="alert" className="a-diag type-small mt-3 border-s-2 border-[var(--color-fail)] ps-3 text-[var(--color-fail)]">Could not load this bundle: {(detail.error as Error).message}</p> : null}
            {detail.isLoading ? (
              <p className="type-small mt-3 flex items-center gap-2">
                <span className="a-blocks" aria-hidden="true"><i /><i /><i /><i /></span>
                Loading problems…
              </p>
            ) : null}
            {detail.data?.problemSet.description ? <p className="type-small mt-3">{detail.data.problemSet.description}</p> : null}
            {detail.data && detail.data.problems.length > 0 ? (
              <div className="gutter mt-5" role="list" aria-label="Problems in this bundle">
                {detail.data.problems.map((problem, index) => (
                  <div key={problem.id} className="gutter-row a-row" role="listitem" style={revealDelay(index)}>
                    <span className="gutter-ln" aria-hidden="true">{index + 1}</span>
                    <div className="gutter-body">
                      <Link className="link" to={`/problems/${problem.id}`}>{problem.title}</Link>
                      <p className="type-micro mt-1">{problem.difficulty} · {problem.tags.join(', ')}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            {detail.data ? <Pagination total={detail.data.totalProblems} limit={detail.data.limit} offset={detail.data.offset} onPageChange={setDetailOffset} label="problems" /> : null}
            {detail.data?.problems[0] ? <Link className="btn btn-quiet mt-4 inline-flex" to={`/problems/${detail.data.problems[0].id}`}>Practice first problem</Link> : null}
            {detail.data ? <button type="button" className="btn btn-primary ms-2 mt-4" onClick={() => void fork(detail.data!.problemSet)}>Fork to my library</button> : null}
          </div>
        </dialog>
      ) : null}

      <div className="statusbar mt-6">
        <span className="statusbar-item" data-strength="strong">public bundles</span>
        <span className="statusbar-item">{bundles ? `${bundles.total} shared` : '—'}</span>
        <span className="statusbar-item">{activeFilters.length > 0 ? activeFilters.join(' · ') : 'no filters'}</span>
        <span className="statusbar-spacer" />
        <span className="statusbar-state" data-state={bundlePage.isError ? 'error' : bundlePage.isFetching ? 'run' : 'ok'}>
          {bundlePage.isError ? 'load failed' : bundlePage.isFetching ? 'querying' : `${leaderboard.data?.total ?? 0} on the board`}
        </span>
      </div>
    </div>
  );
}
