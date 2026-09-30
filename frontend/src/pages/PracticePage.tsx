import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { api, getQueryIdentity, type RunCodeResponse, type SubmissionResponse } from '../services/api';
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
  const identity = getQueryIdentity();

  const problemQuery = useQuery({
    queryKey: ['problem', identity, id],
    queryFn: () => api.problem(id),
    enabled: Number.isFinite(id),
  });

  // Shares the dashboard's cache entry, so the breadcrumb can name the real parent
  // set instead of a generic label.
  const setsQuery = useQuery({ queryKey: ['problemSets', identity], queryFn: () => api.problemSets() });

  const [code, setCode] = useState(SKELETON);
  const { phase, detail, liveStatus, error, elapsedMs, submit, reset } = useCodeSubmission(id);
  const [prefs] = usePreferences();
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(true);
  const [testsOpen, setTestsOpen] = useState(true);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [runStdin, setRunStdin] = useState('');
  const [runResult, setRunResult] = useState<RunCodeResponse | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [runningCode, setRunningCode] = useState(false);

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
    setRunStdin(problemQuery.data.problem.sampleInput ?? problemQuery.data.problem.publicTestCases[0]?.inputData ?? '');
    setRunResult(null);
    setRunError(null);
    reset();
  }, [id, problemQuery.data, reset]);

  const updateCode = (value: string) => {
    setCode(value);
    window.localStorage.setItem(codeKey(id), value);
  };

  const runTests = async () => {
    await submit(code);
    void queryClient.invalidateQueries({ queryKey: ['problem', identity, id] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard', identity] });
    void queryClient.invalidateQueries({ queryKey: ['submissions', identity] });
    // The student just asked for a verdict — make sure the panel that shows it is open.
    setTestsOpen(true);
  };

  const runCode = async () => {
    setConsoleOpen(true);
    setRunningCode(true);
    setRunResult(null);
    setRunError(null);
    try {
      setRunResult(await api.runCode(id, code, runStdin));
    } catch (runRequestError) {
      setRunError(runRequestError instanceof Error ? runRequestError.message : 'Could not run this code.');
    } finally {
      setRunningCode(false);
    }
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
  const codeBusy = running || runningCode;
  const focusMode = !activityOpen && !testsOpen;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden px-3 pb-3 pt-3">
      <StickyNotes />
      <MemoryViz
        open={memoryOpen}
        onClose={() => setMemoryOpen(false)}
        problemId={id}
        code={code}
        stdin={problemQuery.data.problem.publicTestCases[0]?.inputData ?? ''}
      />

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
              disabled={codeBusy}
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

        {/* — The three panels —
         *
         * Side panels stay mounted and animate their width between their size and
         * zero, while the editor's flex-1 absorbs the freed space — one continuous
         * motion, no unmount pop. Content fades and slides as its box collapses.
         */}
        <div className="relative flex min-h-0 flex-1 gap-2 overflow-hidden px-2 pb-2">
          {/* Activity panel (left) */}
          <aside
            className="relative h-full min-h-0 flex-none overflow-visible"
            style={{
              width: activityOpen ? 'min(340px, 30vw)' : '0px',
              transition: `width 300ms ${PANEL_EASE}`,
            }}
            aria-label="Problem statement"
            aria-hidden={!activityOpen}
          >
            <EdgeToggle side="left" open={activityOpen} onClick={() => setActivityOpen((v) => !v)} />
            <div
              className="h-full min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain rounded-[16px] bg-[var(--color-paper)] p-[var(--space-lg)]"
              style={{
                width: activityOpen ? 'min(340px, 30vw)' : '0px',
                opacity: activityOpen ? 1 : 0,
                transform: activityOpen ? 'translateX(0)' : 'translateX(-40px)',
                transition: `opacity 300ms ${PANEL_EASE}, transform 300ms ${PANEL_EASE}`,
              }}
            >
              <ProblemStatement problem={problem} />
            </div>
          </aside>

          {/* Code editor panel (centre — dominant). flex-1 does the easing for us:
           * as a sibling's width animates, the flexbox resolves the remainder every
           * frame, so the editor expands and contracts in lockstep. */}
          <section
            className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[16px] bg-[var(--color-surface-2)]"
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
              <CodeEditor value={code} onChange={updateCode} readOnly={codeBusy} />
            </div>

            {consoleOpen ? (
              <section id="run-console" aria-label="Run code console" className="flex max-h-[45%] min-h-[180px] flex-none flex-col gap-2 overflow-y-auto border-t border-[var(--color-rule)] bg-[var(--color-surface)] px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="mono type-micro">stdin</span>
                  <span className="type-micro text-[var(--color-muted)]">Sandboxed single run · not graded or saved</span>
                  <button type="button" className="btn btn-quiet ms-auto min-h-7 px-2 text-xs" onClick={() => setConsoleOpen(false)} aria-label="Close run code console">
                    Close
                  </button>
                </div>
                <textarea
                  aria-label="Program input (stdin)"
                  className="field min-h-16 w-full resize-y font-mono text-xs leading-5"
                  value={runStdin}
                  onChange={(event) => setRunStdin(event.target.value)}
                  placeholder="Type input for your program…"
                  spellCheck={false}
                  disabled={runningCode}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" className="btn btn-primary min-h-8 px-3 text-xs" onClick={runCode} disabled={codeBusy || code.trim().length === 0}>
                    {runningCode ? 'Running…' : 'Run code'}
                  </button>
                  {runningCode ? <span className="type-micro text-[var(--color-muted)]" role="status">Compiling and running one time…</span> : null}
                  {runResult ? (
                    <span className={`type-micro ${runResult.status === 'completed' ? 'text-[var(--color-pass)]' : 'text-[var(--color-fail)]'}`} role="status">
                      {runResult.status.replace('_', ' ')}{runResult.runtimeMs !== null ? ` · ${runResult.runtimeMs} ms` : ''}
                    </span>
                  ) : null}
                </div>
                {runError ? <p className="type-micro text-[var(--color-fail)]" role="alert">Run failed: {runError}</p> : null}
                {runResult ? (
                  <div className="grid min-h-0 gap-2 sm:grid-cols-2">
                    {runResult.compilationError ? (
                      <div className="sm:col-span-2">
                        <p className="mono type-micro mb-1 text-[var(--color-fail)]">Compilation error</p>
                        <pre className="mono max-h-28 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-[var(--color-surface-2)] p-2 text-xs text-[var(--color-fail)]">{runResult.compilationError}</pre>
                      </div>
                    ) : null}
                    <div>
                      <p className="mono type-micro mb-1">stdout</p>
                      <pre className="mono max-h-28 min-h-8 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-[var(--color-surface-2)] p-2 text-xs">{runResult.stdout || '(no output)'}</pre>
                    </div>
                    <div>
                      <p className="mono type-micro mb-1">stderr</p>
                      <pre className="mono max-h-28 min-h-8 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-[var(--color-surface-2)] p-2 text-xs">{runResult.stderr || '(no errors)'}</pre>
                    </div>
                    {!runResult.compilationError && runResult.compilerOutput ? (
                      <div className="sm:col-span-2">
                        <p className="mono type-micro mb-1">Compiler output</p>
                        <pre className="mono max-h-20 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-[var(--color-surface-2)] p-2 text-xs">{runResult.compilerOutput}</pre>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </section>
            ) : null}

            <div className="flex flex-none flex-wrap items-center gap-1.5 border-t border-[var(--color-rule)] px-3 py-2">
              <button type="button" className="btn btn-primary min-h-9 px-4 text-[13px]" onClick={runTests} disabled={codeBusy || code.trim().length === 0}>
                {running ? 'Grading…' : 'Run tests'}
              </button>
              <button type="button" className="btn btn-quiet min-h-9 px-3 text-[13px]" onClick={runCode} disabled={codeBusy || code.trim().length === 0}>
                {runningCode ? 'Running…' : 'Run code'}
              </button>
              <button type="button" className="btn btn-quiet min-h-9 px-3 text-[13px]" onClick={() => setConsoleOpen((open) => !open)} disabled={codeBusy} aria-expanded={consoleOpen}>
                {consoleOpen ? 'Hide terminal' : 'Terminal'}
              </button>
              {detail ? (
                <button type="button" className="btn btn-quiet min-h-9 px-3 text-[13px]" onClick={reset} disabled={codeBusy}>
                  Clear results
                </button>
              ) : null}
              <span className="mono type-micro ms-auto">Ctrl/Cmd + Enter submits</span>
            </div>
          </section>

          {/* Test cases panel (right) — mirrors the left panel's animation. */}
          <aside
            className="relative h-full min-h-0 flex-none overflow-visible"
            style={{
              width: testsOpen ? 'min(380px, 32vw)' : '0px',
              transition: `width 300ms ${PANEL_EASE}`,
            }}
            aria-label="Test cases and results"
            aria-hidden={!testsOpen}
          >
            <EdgeToggle side="right" open={testsOpen} onClick={() => setTestsOpen((v) => !v)} />
            <div
              className="flex h-full min-h-0 flex-col overflow-x-hidden overflow-y-auto overscroll-contain rounded-[16px] bg-[var(--color-paper)] p-[var(--space-md)]"
              style={{
                width: testsOpen ? 'min(380px, 32vw)' : '0px',
                opacity: testsOpen ? 1 : 0,
                transform: testsOpen ? 'translateX(0)' : 'translateX(40px)',
                transition: `opacity 300ms ${PANEL_EASE}, transform 300ms ${PANEL_EASE}`,
              }}
            >
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
                <div className="flex min-h-full flex-col items-center justify-center gap-2 text-center">
                  <p className="type-small text-[var(--color-muted)]">No results yet.</p>
                  <p className="type-micro max-w-[240px]">
                    Press Run tests — verdicts, inputs, expected outputs and diffs land here.
                  </p>
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>

      {/* Always mounted, so a change to its text is what announces the verdict. */}
      <p role="status" className="sr-only">
        {verdictAnnouncement(detail)}
      </p>
    </div>
  );
}
