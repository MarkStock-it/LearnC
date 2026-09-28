import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { api, type SubmissionResponse } from '../services/api';
import { useCodeSubmission } from '../hooks/useCodeSubmission';
import { CodeEditor } from '../components/Editor/CodeEditor';
import { ProblemStatement } from '../components/ProblemView/ProblemStatement';
import { TestResultsTable } from '../components/ProblemView/TestResultsTable';
import { ExecutionStack } from '../components/ProblemView/ExecutionStack';
import { MemoryViz } from '../components/ProblemView/MemoryViz';
import { StickyNotes } from '../components/ProblemView/StickyNotes';
import { EdgeToggle } from '../components/ProblemView/EdgeToggle';
import { StatusMark } from '../components/ui/StatusMark';
import { usePreferences } from '../lib/preferences';

/**
 * Spoken summary of a finished submission.
 *
 * The running line below only exists while grading, so it cannot announce the
 * outcome — an element unmounts rather than changes. This text feeds a status
 * region that is mounted from the first render instead.
 */
function verdictAnnouncement(detail: SubmissionResponse | null): string {
  if (!detail) return '';

  const { submission, solved } = detail;
  if (submission.compilationError) {
    return 'Compilation failed. The compiler output is listed above the test cases.';
  }

  const outcome = solved ? 'Problem solved.' : 'Not solved yet.';
  return `Graded: ${submission.passedCount} of ${submission.totalCount} test cases passed. ${outcome}`;
}

const SKELETON = `#include <stdio.h>

int main(void) {
    /* Read from stdin, write the answer to stdout. */

    return 0;
}
`;

const codeKey = (problemId: number): string => `c-practice.code.${problemId}`;

const STATUS_TEXT: Record<string, string> = {
  QUEUED: 'Waiting for a free sandbox slot',
  COMPILING: 'Compiling your code',
  EXECUTING: 'Running the test cases',
  COMPLETED: 'Done',
  FAILED: 'The grader reported an infrastructure error',
};

const PANEL_EASE = 'cubic-bezier(0.4, 0, 0.2, 1)';

/**
 * The three-panel workbench: Activity (statement) left, code centre — always the
 * dominant panel — and Test Cases right, all inside one heavily rounded container.
 * Either side collapses off-screen with an eased slide while the editor absorbs the
 * freed space; both collapsed is full-screen code mode. All grading logic is
 * untouched — this is purely the arrangement around it.
 */
export function PracticePage() {
  const { problemId } = useParams();
  const id = Number(problemId);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const problemQuery = useQuery({
    queryKey: ['problem', id],
    queryFn: () => api.problem(id),
    enabled: Number.isFinite(id),
  });

  // Shares the dashboard's cache entry, so the breadcrumb can name the real parent
  // set instead of a generic label.
  const setsQuery = useQuery({ queryKey: ['problemSets'], queryFn: api.problemSets });

  const [code, setCode] = useState(SKELETON);
  const { phase, detail, liveStatus, error, elapsedMs, submit, reset } = useCodeSubmission(id);
  const [prefs] = usePreferences();
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(true);
  const [testsOpen, setTestsOpen] = useState(true);

  /**
   * Restore in-progress work once per problem.
   *
   * The guard matters: after a submission the problem query is invalidated to refresh
   * the progress line, which hands this effect a new data object. Without a stable key
   * it would re-run and wipe the verdict the student is reading.
   */
  const loadedProblemId = useRef<number | null>(null);
  useEffect(() => {
    if (!problemQuery.data) return;
    if (loadedProblemId.current === id) return;
    loadedProblemId.current = id;

    const saved = window.localStorage.getItem(codeKey(id));
    setCode(saved && saved.trim().length > 0 ? saved : SKELETON);
    reset();
  }, [id, problemQuery.data, reset]);

  const updateCode = (value: string) => {
    setCode(value);
    window.localStorage.setItem(codeKey(id), value);
  };

  const runTests = async () => {
    await submit(code);
    void queryClient.invalidateQueries({ queryKey: ['problem', id] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    void queryClient.invalidateQueries({ queryKey: ['submissions'] });
    // The student just asked for a verdict — make sure the panel that shows it is open.
    setTestsOpen(true);
  };

  if (!Number.isFinite(id)) {
    return <p className="type-small text-[var(--color-fail)]">That problem id is not valid.</p>;
  }

  if (problemQuery.isLoading) {
    return <p className="type-small text-[var(--color-muted)]">Loading the statement…</p>;
  }

  if (problemQuery.isError || !problemQuery.data) {
    return (
      <p className="type-small text-[var(--color-fail)]">
        This problem could not be loaded: {(problemQuery.error as Error)?.message ?? 'unknown error'}
      </p>
    );
  }

  const { problem, progress } = problemQuery.data;
  const problemSetTitle =
    setsQuery.data?.problemSets.find((entry) => entry.id === problem.problemSetId)?.title ?? 'Problem set';
  const running = phase === 'running';
  const focusMode = !activityOpen && !testsOpen;

  return (
    <div className="flex min-h-[calc(100dvh-3.5rem)] flex-col px-3 pb-3 pt-3 md:px-5">
      <StickyNotes />
      <MemoryViz open={memoryOpen} onClose={() => setMemoryOpen(false)} />

      {/* — Unified container: top bar + three panels — */}
      <div
        className={`relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[24px] border border-[var(--color-rule)] bg-[var(--color-surface)] shadow-[0_18px_50px_oklch(20%_0.02_250_/_0.10)] transition-opacity duration-300 ${
          focusMode ? 'opacity-95' : ''
        }`}
      >
        {/* — Top bar: back button · breadcrumb · preference buttons — */}
        <header
          className={`flex flex-none items-center gap-3 px-4 py-2.5 transition-opacity duration-300 ${
            focusMode ? 'opacity-40 hover:opacity-100' : ''
          }`}
        >
          <button
            type="button"
            onClick={() => navigate(`/sets/${problem.problemSetId}`)}
            aria-label="Back to the problem set"
            title="Back to the problem set"
            className="flex size-7 items-center justify-center rounded-full bg-[var(--color-fail)] text-[var(--color-accent-ink)] shadow-[0_1px_4px_oklch(20%_0.02_250_/_0.3)] transition-transform duration-200 hover:scale-110"
          >
            <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M10 3.5 5.5 8l4.5 4.5" />
            </svg>
          </button>

          <nav aria-label="Breadcrumb" className="type-micro flex min-w-0 items-center gap-1.5">
            <span className="hidden sm:inline">Problem sets</span>
            <span className="hidden sm:inline" aria-hidden>/</span>
            <span className="max-w-[180px] truncate text-[var(--color-muted)]">{problemSetTitle}</span>
            <span aria-hidden>/</span>
            <span className="truncate font-[var(--weight-medium)] text-[var(--color-ink)]">{problem.title}</span>
          </nav>

          <div className="ms-auto flex items-center gap-1.5">
            {/* Preference circles — the gear from the toolbar, restyled for this bar. */}
            {prefs.memoryViz ? (
              <button
                type="button"
                onClick={() => setMemoryOpen(true)}
                aria-haspopup="dialog"
                aria-label="Open memory walkthrough"
                title="Memory walkthrough"
                className="flex size-7 items-center justify-center rounded-full bg-[var(--color-surface-2)] text-[var(--color-muted)] transition-transform duration-200 hover:scale-110 hover:text-[var(--color-ink)]"
              >
                <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                  <rect x="2.5" y="4" width="11" height="8" rx="2" />
                  <path d="M5.5 4V2.5M10.5 4V2.5M5.5 13.5V12M10.5 13.5V12M2.5 8h11" />
                </svg>
              </button>
            ) : null}
            <button
              type="button"
              aria-label="Reset code to the skeleton"
              title="Reset code"
              disabled={running}
              onClick={() => {
                reset();
                updateCode(SKELETON);
              }}
              className="flex size-7 items-center justify-center rounded-full bg-[var(--color-surface-2)] text-[var(--color-muted)] transition-transform duration-200 hover:scale-110 hover:text-[var(--color-ink)] disabled:opacity-40"
            >
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v2.6h-2.6" />
              </svg>
            </button>
            <span
              className={`num type-micro ms-1 ${progress.solved ? 'verdict-pass' : ''}`}
              title={`${progress.attempts} attempts, best ${progress.bestPassedCount} of ${problem.testCaseCount}`}
            >
              {progress.solved ? (
                <span className="flex items-center gap-1">
                  <StatusMark kind="pass" />
                  solved
                </span>
              ) : (
                `${progress.bestPassedCount}/${problem.testCaseCount}`
              )}
            </span>
          </div>
        </header>

        {/* — The three panels — */}
        <div className="relative flex min-h-0 flex-1 gap-2 px-2 pb-2">
          {/* Activity panel (left) */}
          {activityOpen ? (
            <aside
              className="relative w-[300px] flex-none overflow-hidden rounded-[16px] bg-[var(--color-paper)] md:w-[340px]"
              style={{ animation: `panel-in 300ms ${PANEL_EASE}` }}
              aria-label="Problem statement"
            >
              <EdgeToggle side="left" open onClick={() => setActivityOpen(false)} />
              <div className="h-full overflow-y-auto p-[var(--space-lg)]">
                <ProblemStatement problem={problem} />
              </div>
            </aside>
          ) : (
            <div className="relative flex w-0 flex-none" aria-hidden={!activityOpen}>
              <EdgeToggle side="left" open={false} onClick={() => setActivityOpen(true)} />
            </div>
          )}

          {/* Code editor panel (centre — dominant) */}
          <section
            className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-[16px] bg-[var(--color-surface-2)] transition-[flex] duration-300"
            style={{ transitionTimingFunction: PANEL_EASE }}
            aria-label="Your solution"
          >
            <div className="flex flex-none items-center gap-2 px-3 py-1.5">
              <span className="mono type-micro">solution.c</span>
              <span className="num type-micro">
                {progress.attempts === 0
                  ? 'No attempts yet'
                  : `${progress.attempts} attempt${progress.attempts === 1 ? '' : 's'}`}
              </span>
              {running ? (
                <span className="type-micro ms-auto flex items-center gap-1.5" role="status">
                  <span aria-hidden className="inline-block size-1.5 animate-pulse rounded-full bg-[var(--color-accent)]" />
                  {STATUS_TEXT[liveStatus ?? 'QUEUED']}
                  <span className="num">{(elapsedMs / 1000).toFixed(1)}s</span>
                </span>
              ) : null}
            </div>

            <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
              <CodeEditor value={code} onChange={updateCode} readOnly={running} />
            </div>

            <div className="flex flex-none flex-wrap items-center gap-1.5 border-t border-[var(--color-rule)] px-3 py-2">
              <button type="button" className="btn btn-primary min-h-9 px-4 text-[13px]" onClick={runTests} disabled={running || code.trim().length === 0}>
                {running ? 'Grading…' : 'Run tests'}
              </button>
              {detail ? (
                <button type="button" className="btn btn-quiet min-h-9 px-3 text-[13px]" onClick={reset}>
                  Clear results
                </button>
              ) : null}
              <span className="mono type-micro ms-auto">Ctrl/Cmd + Enter submits</span>
            </div>
          </section>

          {/* Test cases panel (right) */}
          {testsOpen ? (
            <aside
              className="relative w-[340px] flex-none overflow-hidden rounded-[16px] bg-[var(--color-paper)] md:w-[380px]"
              style={{ animation: `panel-in 300ms ${PANEL_EASE}` }}
              aria-label="Test cases and results"
            >
              <EdgeToggle side="right" open onClick={() => setTestsOpen(false)} />
              <div className="flex h-full flex-col overflow-y-auto p-[var(--space-md)]">
                {error ? (
                  <p className="type-small mb-2 text-[var(--color-fail)]" role="alert">
                    No verdict came back: {error}
                  </p>
                ) : null}
                {detail ? (
                  <div className="flex flex-col gap-[var(--space-md)]">
                    <TestResultsTable detail={detail} />
                    {prefs.executionStack ? <ExecutionStack detail={detail} /> : null}
                  </div>
                ) : (
                  <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
                    <p className="type-small text-[var(--color-muted)]">No results yet.</p>
                    <p className="type-micro max-w-[240px]">
                      Press Run tests — verdicts, inputs, expected outputs and diffs land here.
                    </p>
                  </div>
                )}
              </div>
            </aside>
          ) : (
            <div className="relative flex w-0 flex-none" aria-hidden={!testsOpen}>
              <EdgeToggle side="right" open={false} onClick={() => setTestsOpen(true)} />
            </div>
          )}
        </div>
      </div>

      {/* Always mounted, so a change to its text is what announces the verdict. */}
      <p role="status" className="sr-only">
        {verdictAnnouncement(detail)}
      </p>
    </div>
  );
}
