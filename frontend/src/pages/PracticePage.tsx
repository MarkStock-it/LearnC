import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api, type SubmissionResponse } from '../services/api';
import { useCodeSubmission } from '../hooks/useCodeSubmission';
import { CodeEditor } from '../components/Editor/CodeEditor';
import { ProblemStatement } from '../components/ProblemView/ProblemStatement';
import { TestResultsTable } from '../components/ProblemView/TestResultsTable';
import { ExecutionStack } from '../components/ProblemView/ExecutionStack';
import { MemoryViz } from '../components/ProblemView/MemoryViz';
import { StatusMark } from '../components/ui/StatusMark';
import { revealDelay } from '../lib/reveal';
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

/**
 * Workbench macrostructure: the statement and the editor sit side by side on an
 * uneven split, with the verdict landing underneath the editor where the student is
 * already looking. Nothing moves except the verdict panel, which springs in from the
 * current value so a re-submit mid-animation continues rather than jumping.
 */
export function PracticePage() {
  const { problemId } = useParams();
  const id = Number(problemId);
  const queryClient = useQueryClient();

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

  return (
    <div className="flex flex-col gap-[var(--space-lg)]">
      <nav aria-label="Breadcrumb" className="type-micro reveal" style={revealDelay(0)}>
        <Link to="/" className="link">
          Problem sets
        </Link>
        <span className="mx-1.5">/</span>
        <Link to={`/sets/${problem.problemSetId}`} className="link">
          {problemSetTitle}
        </Link>
        <span className="mx-1.5">/</span>
        <span className="text-[var(--color-muted)]">{problem.title}</span>
      </nav>

      <div className="grid gap-[var(--space-xl)] xl:grid-cols-[minmax(0,1.06fr)_minmax(0,1fr)]">
        <section className="sheet reveal min-w-0 p-[var(--space-lg)] md:p-[var(--space-xl)]" style={revealDelay(1)}>
          <ProblemStatement problem={problem} />
        </section>

        <section className="reveal flex min-w-0 flex-col gap-[var(--space-md)]" style={revealDelay(2)}>
          <div className="sheet overflow-hidden">
            <div className="border-b border-[var(--color-rule)] px-[var(--space-md)] py-[var(--space-sm)]">
              <h2 className="type-title">Your solution</h2>

              {/* The pane's metadata stacks beneath its heading (gate 54). */}
              <div className="mt-[var(--space-2xs)] flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="mono type-micro">solution.c</span>
                <span className="num type-micro">
                  {progress.attempts === 0
                    ? 'No attempts yet'
                    : `${progress.attempts} attempt${progress.attempts === 1 ? '' : 's'}, best ${progress.bestPassedCount} of ${problem.testCaseCount}`}
                </span>
                {progress.solved ? (
                  <span className="verdict-pass flex items-center gap-1.5">
                    <StatusMark kind="pass" />
                    <span className="type-micro text-[var(--color-pass)]">Solved</span>
                  </span>
                ) : null}
              </div>
            </div>

            <div className="h-[min(56vh,520px)]">
              <CodeEditor value={code} onChange={updateCode} readOnly={running} />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-[var(--space-xs)]">
            <button type="button" className="btn btn-primary" onClick={runTests} disabled={running || code.trim().length === 0}>
              {running ? 'Grading…' : 'Run tests'}
            </button>
            {prefs.memoryViz ? (
              <button
                type="button"
                className="btn btn-quiet"
                onClick={() => setMemoryOpen(true)}
                aria-haspopup="dialog"
              >
                Memory
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn-quiet"
              disabled={running}
              onClick={() => {
                reset();
                updateCode(SKELETON);
              }}
            >
              Reset code
            </button>
            {detail ? (
              <button type="button" className="btn btn-quiet" onClick={reset}>
                Clear results
              </button>
            ) : null}
            <span className="mono type-micro ms-auto">Ctrl/Cmd + Enter submits</span>
          </div>

          {/* Always mounted, so a change to its text is what announces the verdict. */}
          <p role="status" className="sr-only">
            {verdictAnnouncement(detail)}
          </p>

          {running ? (
            <p className="type-small flex items-center gap-2 text-[var(--color-muted)]" role="status">
              <span
                aria-hidden
                className="inline-block size-1.5 animate-pulse rounded-full bg-[var(--color-accent)]"
              />
              {STATUS_TEXT[liveStatus ?? 'QUEUED']}
              <span className="num type-micro ms-auto">{(elapsedMs / 1000).toFixed(1)}s</span>
            </p>
          ) : null}

          {error ? (
            <p className="type-small text-[var(--color-fail)]" role="alert">
              No verdict came back: {error}
            </p>
          ) : null}

          {detail ? <TestResultsTable detail={detail} /> : null}
          {detail && prefs.executionStack ? <ExecutionStack detail={detail} /> : null}
        </section>
      </div>

      <MemoryViz open={memoryOpen} onClose={() => setMemoryOpen(false)} />
    </div>
  );
}
