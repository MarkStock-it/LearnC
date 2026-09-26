import { spawn } from 'node:child_process';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { ExecutionLimits, ExecutionOutcome, TestCaseRun, ErrorType } from '../../domain/types.js';
import { classifyProcessOutcome, truncate } from '../evaluationService.js';

export interface ExecuteRequest {
  code: string;
  /** Expected outputs travel with the request so the sandbox can judge in one pass. */
  testCases: Array<{ id: number; inputData: string; expectedOutput: string }>;
  limits: ExecutionLimits;
}

/** A sandbox capable of compiling C once and running it against many inputs. */
export interface CodeExecutor {
  readonly kind: 'docker' | 'local';
  isAvailable(): Promise<boolean>;
  execute(request: ExecuteRequest): Promise<ExecutionOutcome>;
}

export interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  runtimeMs: number;
  spawnError: string | null;
}

/**
 * Spawn a process with a hard wall-clock timeout and bounded output capture.
 * Killing is platform-aware: POSIX gets a process group so children die with the
 * parent, Windows needs `taskkill /T` for the same guarantee.
 */
export function runProcess(options: {
  command: string;
  args: string[];
  cwd: string;
  stdin?: string;
  timeoutMs: number;
  maxOutputBytes: number;
  /**
   * Environment for the child. Toolchains need this: MSYS2/MinGW `gcc.exe` spawns
   * `cc1`/`as`/`ld`, which load libgmp/libwinpthread from the toolchain's own `bin`
   * directory. If that directory is not on PATH those children die silently and the
   * driver exits with status 1 and no diagnostics.
   */
  env?: NodeJS.ProcessEnv;
}): Promise<ProcessResult> {
  const { command, args, cwd, stdin = '', timeoutMs, maxOutputBytes, env } = options;

  return new Promise<ProcessResult>((resolve) => {
    const startedAt = process.hrtime.bigint();
    const isWindows = process.platform === 'win32';
    let stdout: Buffer = Buffer.alloc(0);
    let stderr: Buffer = Buffer.alloc(0);
    let timedOut = false;
    let settled = false;
    let spawnError: string | null = null;

    const child = spawn(command, args, {
      cwd,
      windowsHide: true,
      detached: !isWindows,
      stdio: ['pipe', 'pipe', 'pipe'],
      ...(env ? { env } : {}),
    });

    const killTree = (signal: NodeJS.Signals) => {
      if (child.pid === undefined) return;
      try {
        if (isWindows) {
          spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
        } else {
          process.kill(-child.pid, signal);
        }
      } catch {
        try {
          child.kill(signal);
        } catch {
          /* already gone */
        }
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killTree('SIGKILL');
    }, timeoutMs);

    const append = (current: Buffer, chunk: Buffer): Buffer => {
      const next = Buffer.concat([current, chunk]);
      return next.byteLength > maxOutputBytes ? next.subarray(0, maxOutputBytes) : next;
    };

    child.stdout.on('data', (chunk: Buffer) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = append(stderr, chunk);
    });

    child.on('error', (error) => {
      spawnError = error.message;
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const runtimeMs = Number((process.hrtime.bigint() - startedAt) / 1_000_000n);
      resolve({
        stdout: stdout.toString('utf8'),
        stderr: stderr.toString('utf8'),
        exitCode: code,
        timedOut,
        runtimeMs,
        spawnError,
      });
    });

    if (child.stdin) {
      child.stdin.on('error', () => {
        /* programs that never read stdin close the pipe early — not an error */
      });
      if (stdin.length > 0) child.stdin.write(stdin);
      child.stdin.end();
    }
  });
}

/** Scratch directory for one submission, removed after the run. */
export function createScratchDir(): string {
  const dir = path.join(os.tmpdir(), 'c-practice', `sub-${Date.now()}-${randomBytes(4).toString('hex')}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function removeScratchDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best effort — a leaked temp dir must never fail a submission */
  }
}

/** Turn a finished process into a verdict for one test case. */
export function toTestCaseRun(options: {
  testCaseId: number;
  process: ProcessResult;
  expectedOutput: string;
  maxOutputBytes: number;
  compare: (expected: string, actual: string) => { passed: boolean };
}): TestCaseRun {
  const { testCaseId, process: proc, expectedOutput, maxOutputBytes, compare } = options;

  const actualOutput = truncate(proc.stdout, maxOutputBytes);
  const stderr = truncate(proc.spawnError ? `${proc.spawnError}\n${proc.stderr}` : proc.stderr, maxOutputBytes);
  const comparison = compare(expectedOutput, actualOutput);
  const errorType: ErrorType = classifyProcessOutcome({
    exitCode: proc.exitCode,
    timedOut: proc.timedOut,
    stderr,
    stdoutMatched: comparison.passed,
  });

  return {
    testCaseId,
    passed: errorType === 'PASS',
    errorType,
    actualOutput,
    stderr,
    runtimeMs: proc.runtimeMs,
    // Neither sandbox reports precise peak RSS yet; Docker's OOM killer is the
    // enforcement mechanism, and the field is null until stats are wired up.
    memoryUsedMb: null,
  };
}
