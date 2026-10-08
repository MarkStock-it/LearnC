/**
 * Instant, free, server-free test runs — with a REAL compiler.
 *
 * Practice attempts run here first: the student's code is compiled once with
 * clang (wasm32-wasi, server-parity flags) on their own machine, then the
 * resulting binary runs every public test case locally. A classroom of a
 * hundred students costs the server nothing and waits on no queue. This is a
 * *preview*, not a verdict — official grading still goes through `api.submit`
 * and the sandboxed executor, which alone sees the hidden cases.
 */
import { compareOutputs, type OutputDiffLine } from '../lib/cPreview';
import type { PreviewWorkerRequest, PreviewWorkerResult } from '../workers/cRunner.worker';
import type {
  DiffLine,
  ErrorType,
  SubmissionResponse,
  TestCaseResult,
} from './api';

export interface PreviewCaseInput {
  input: string;
  expected: string;
  description?: string | null;
}

export interface PreviewCaseResult {
  index: number;
  input: string;
  expected: string;
  actual: string | null;
  passed: boolean;
  errorType: ErrorType;
  message: string;
  runtimeMs: number | null;
  diff: OutputDiffLine[];
}

export interface PreviewRun {
  results: PreviewCaseResult[];
  /** Set when the whole run bowed out before executing (e.g. no compilation). */
  runError: string | null;
  notes: string[];
  /** Compiler warnings (advisory, like the server's). */
  compileWarnings: string | null;
}

export interface PreviewProgress {
  /** 'toolchain' while the ~52MB compiler downloads (first preview only). */
  stage: 'toolchain' | 'compile' | 'run';
  loadedBytes: number;
  totalBytes: number;
}

/** Wall-clock for the one compile (includes toolchain download + init). */
const COMPILE_MS = 120_000;
/** Wall-clock per case run, including worker spin-up. */
const PER_CASE_MS = 10000;

function spawnWorker(): Worker {
  return new Worker(new URL('../workers/cRunner.worker.ts', import.meta.url), { type: 'module' });
}

interface PendingWaiter {
  resolve: (result: PreviewWorkerResult) => void;
  timer: number;
  worker: Worker;
}

function sendWithWatchdog(
  worker: Worker,
  request: PreviewWorkerRequest,
  timeoutMs: number,
  onProgress?: (progress: PreviewProgress) => void,
): Promise<PreviewWorkerResult> {
  return new Promise((resolve) => {
    const waiter: PendingWaiter = { resolve, timer: 0, worker };
    const cleanup = () => {
      window.clearTimeout(waiter.timer);
      worker.removeEventListener('message', onMessage);
    };
    const onMessage = (event: MessageEvent<PreviewWorkerResult>) => {
      const result = event.data;
      if (!result) return;
      if (result.kind === 'toolchain-progress') {
        onProgress?.({ stage: 'toolchain', loadedBytes: result.loadedBytes, totalBytes: result.totalBytes });
        return;
      }
      if (request.kind === 'compile' && result.kind !== 'compiled') return;
      if (request.kind === 'run' && result.kind !== 'result') return;
      if ('id' in result && result.id !== request.id) return;
      cleanup();
      resolve(result);
    };
    worker.addEventListener('message', onMessage);
    waiter.timer = window.setTimeout(() => {
      cleanup();
      worker.terminate();
      if (request.kind === 'compile') {
        resolve({ kind: 'compiled', id: request.id, ok: false, diagnostics: 'Compilation took too long and was stopped.' });
      } else {
        resolve({ kind: 'result', id: request.id, ok: false, message: 'Preview watchdog: the case overran its wall-clock budget.' });
      }
    }, timeoutMs);
    worker.postMessage(request);
  });
}

function verdictFor(
  stdout: string,
  exitCode: number,
  stderr: string,
  runtimeMs: number,
  expected: string,
): Omit<PreviewCaseResult, 'index' | 'input' | 'expected'> {
  if (exitCode !== 0 && stdout.length === 0 && stderr.length === 0) {
    // Traps (e.g. stack overflow, abort) produce no output at all.
    return {
      actual: '',
      passed: false,
      errorType: 'RUNTIME_ERROR',
      message: `The program crashed (exit code ${exitCode}) without printing anything. Check array bounds, pointer initialisation, and recursion depth.`,
      runtimeMs,
      diff: [],
    };
  }
  const compared = compareOutputs(expected, stdout);
  if (compared.passed) {
    return {
      actual: stdout,
      passed: true,
      errorType: 'PASS',
      message: 'Matches the expected output (preview).',
      runtimeMs,
      diff: [],
    };
  }
  if (exitCode !== 0) {
    return {
      actual: stdout,
      passed: false,
      errorType: 'RUNTIME_ERROR',
      message: `The program exited with code ${exitCode} and the output differs (preview).${stderr ? ` Last error: ${stderr.slice(0, 200)}` : ''}`,
      runtimeMs,
      diff: compared.diff,
    };
  }
  return {
    actual: stdout,
    passed: false,
    errorType: 'WRONG_ANSWER',
    message: 'The output differs from the expected output (preview).',
    runtimeMs,
    diff: compared.diff,
  };
}

/**
 * Compile `code` once, then run every case against the same binary — one
 * persistent worker for the whole preview (a timed-out step terminates and
 * recreates it, so one bad step cannot poison the rest).
 */
export async function previewCode(
  code: string,
  cases: PreviewCaseInput[],
  options?: { signal?: AbortSignal; onProgress?: (progress: PreviewProgress) => void },
): Promise<PreviewRun> {
  const results: PreviewCaseResult[] = [];
  const notes: string[] = [];
  let worker = spawnWorker();

  const aborted = () => options?.signal?.aborted === true;

  // --- compile once ---
  options?.onProgress?.({ stage: 'compile', loadedBytes: 0, totalBytes: 0 });
  const compiled = await sendWithWatchdog(worker, { kind: 'compile', id: 0, code }, COMPILE_MS, options?.onProgress);
  if (aborted()) {
    worker.terminate();
    return { results, runError: null, notes, compileWarnings: null };
  }
  if (compiled.kind !== 'compiled' || !compiled.ok) {
    worker.terminate();
    const diagnostics = compiled.kind === 'compiled' && !compiled.ok ? compiled.diagnostics : 'Compilation produced no result.';
    return {
      results: [],
      runError: `The compiler rejected this code:\n${diagnostics}\nFix the errors above, or use Run tests to confirm against the server compiler.`,
      notes,
      compileWarnings: null,
    };
  }
  const compileWarnings = compiled.warnings.length > 0 ? compiled.warnings : null;

  // --- run every case against the same binary ---
  for (let index = 0; index < cases.length; index += 1) {
    if (aborted()) break;
    const testCase = cases[index]!;
    options?.onProgress?.({ stage: 'run', loadedBytes: index, totalBytes: cases.length });
    const outcome = await sendWithWatchdog(worker, { kind: 'run', id: index + 1, stdin: testCase.input }, PER_CASE_MS);
    if (aborted()) break;

    if (outcome.kind !== 'result') {
      worker.terminate();
      return { results, runError: 'The preview worker answered unexpectedly. Use Run tests.', notes, compileWarnings };
    }
    if (!outcome.ok) {
      // Watchdog timeout: same binary runs every remaining case, so stop now
      // instead of burning the budget on each one.
      results.push({
        index,
        input: testCase.input,
        expected: testCase.expected,
        actual: null,
        passed: false,
        errorType: 'TIMEOUT',
        message: 'Still running when the preview limit hit — likely an unbounded loop. Run tests to confirm under the official limit.',
        runtimeMs: null,
        diff: [],
      });
      worker.terminate();
      return {
        results,
        runError: 'Stopped after the first timeout: every case runs the same program. Check for an unbounded loop, then use Run tests for the official verdict.',
        notes,
        compileWarnings,
      };
    }
    const verdict = verdictFor(outcome.stdout, outcome.exitCode, outcome.stderr, outcome.runtimeMs, testCase.expected);
    results.push({ index, input: testCase.input, expected: testCase.expected, ...verdict });
  }

  worker.terminate();
  if (results.length > 0) {
    notes.push('Public cases only — hidden cases are graded on the server.');
  }
  return { results, runError: null, notes, compileWarnings };
}

/**
 * Shape a preview run as the results table's `SubmissionResponse`, so the same
 * verdict UI renders both paths. The `executor` label is what tells the reader
 * this is a preview, not a grade.
 */
export function toPreviewSubmission(
  problemId: number,
  code: string,
  run: PreviewRun,
  timeLimitSeconds: number | null,
): SubmissionResponse {
  const compileFailed = run.results.some((result) => result.errorType === 'COMPILATION_ERROR');
  const passedCount = run.results.filter((result) => result.passed).length;
  const now = new Date().toISOString();
  const results: TestCaseResult[] = run.results.map((result) => ({
    testCaseId: result.index,
    label: `Public case ${result.index + 1}`,
    description: null,
    isPublic: true,
    passed: result.passed,
    errorType: result.errorType,
    message: result.message,
    runtimeMs: result.runtimeMs,
    memoryUsedMb: null,
    stderr: null,
    inputData: result.input,
    expectedOutput: result.expected,
    actualOutput: result.actual,
    diff: result.diff.map(
      (line): DiffLine => ({ line: line.line, expected: line.expected, actual: line.actual }),
    ),
  }));
  return {
    submission: {
      id: -1,
      problemId,
      problemTitle: null,
      status: 'COMPLETED',
      compilationError: compileFailed ? 'The preview compiler rejected this code (see the first case).' : null,
      executor: 'browser preview (real C compiler)',
      errorMessage: null,
      passedCount,
      totalCount: run.results.length,
      createdAt: now,
      completedAt: now,
      code,
      isFinished: true,
    },
    results,
    solved: false,
    limits: { timeLimitSeconds, memoryLimitMb: 256 },
  };
}
