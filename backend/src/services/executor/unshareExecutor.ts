import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { config, resolveCompiler } from '../../config.js';
import type { ExecutionOutcome, TestCaseRun, ErrorType } from '../../domain/types.js';
import { classifyProcessOutcome, compareOutput, truncate } from '../evaluationService.js';
import { logger } from '../../utils/logger.js';
import { removeScratchDir, runProcess, type CodeExecutor, type ExecuteRequest } from './executor.js';

/**
 * Production sandbox for hosts without Docker: Linux user namespaces.
 *
 * One `unshare` session per submission runs a runner script that:
 * - makes every mount private and remounts `/` read-only, so host files cannot
 *   be modified (the program's writes land in a private tmpfs at /tmp);
 * - drops into a PID namespace with `--kill-child` so forks cannot outlive the
 *   run and the whole tree is reaped, with the process count capped via
 *   RLIMIT_NPROC;
 * - applies RLIMIT_AS / RLIMIT_CPU / RLIMIT_FSIZE / RLIMIT_CORE per test case;
 * - drops into a fresh network namespace: only an unconfigured loopback, so
 *   there are no outbound sockets.
 *
 * The submission inputs live in `EXECUTOR_SCRATCH_DIR` (default: the app data
 * directory, NOT /tmp — the runner mounts a private tmpfs over /tmp, which would
 * hide them). The read-only root makes them visible but immutable inside.
 *
 * This is the same isolation Docker is built on (namespaces + mount states +
 * rlimits), driven directly. It needs no root: user namespaces are
 * unprivileged, and this host allows them (`unshare --user --map-root-user`
 * verified on Debian 12, kernel 6.1).
 */

const RUNNER = `#!/bin/sh
set -u
# Private mount state: / writable in this namespace only, then read-only.
mount --make-rprivate / || exit 90
mount -t tmpfs -o size=64m,nosuid,nodev tmpfs /tmp || exit 91
mount -o remount,ro,bind / || exit 92
mkdir -p /tmp/work
cd /tmp/work || exit 93

echo "::START"
gcc {COMPILER_FLAGS} -o /tmp/work/program {SOURCE_FILES} {LINK_FLAGS} > /tmp/work/compile.log 2>&1
compile_exit=$?
echo "::COMPILE_EXIT $compile_exit"
echo "::COMPILE_B64 $(head -c {MAX_OUTPUT_BYTES} /tmp/work/compile.log | base64 | tr -d '\\n')"
if [ "$compile_exit" -ne 0 ]; then
  echo "::DONE"
  exit 0
fi

for input in {INPUTS_DIR}/cases/*.in; do
  [ -e "$input" ] || continue
  id=$(basename "$input" .in)
  started=$(date +%s%N)
  prlimit --as={MEMORY_BYTES} --cpu={CPU_SECONDS} --fsize=67108864 --core=0 --nproc={PIDS_LIMIT} timeout -s KILL {TIME_SECONDS} /tmp/work/program < "$input" > /tmp/work/out.txt 2> /tmp/work/err.txt
  status=$?
  finished=$(date +%s%N)
  echo "::CASE $id"
  echo "::EXIT $status"
  echo "::MS $(( (finished - started) / 1000000 ))"
  echo "::STDOUT_B64 $(head -c {MAX_OUTPUT_BYTES} /tmp/work/out.txt | base64 | tr -d '\\n')"
  echo "::STDERR_B64 $(head -c {MAX_OUTPUT_BYTES} /tmp/work/err.txt | base64 | tr -d '\\n')"
done
echo "::DONE"
`;

function findUnshare(): string | null {
  for (const candidate of ['/usr/bin/unshare', '/bin/unshare']) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/** Scratch root for submission inputs. Must not be /tmp (the runner tmpfs-mounts over it). */
function scratchRoot(): string {
  const configured = process.env.EXECUTOR_SCRATCH_DIR;
  if (configured && configured.length > 0) return configured;
  // Safe default: next to the SQLite file / app data, i.e. the app's own disk.
  return path.join(path.dirname(config.db.sqliteFile), 'scratch');
}

interface ParsedCase {
  testCaseId: number;
  exitCode: number;
  runtimeMs: number;
  stdout: string;
  stderr: string;
}

export function parseRunnerOutput(text: string): {
  compileExitCode: number | null;
  compileOutput: string;
  cases: ParsedCase[];
  completed: boolean;
} {
  let compileExitCode: number | null = null;
  let compileOutput = '';
  const cases: ParsedCase[] = [];
  let current: ParsedCase | null = null;
  let completed = false;

  const decode = (value: string): string => {
    const trimmed = value.trim();
    if (!trimmed) return '';
    try {
      return Buffer.from(trimmed, 'base64').toString('utf8');
    } catch {
      return '';
    }
  };

  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line.includes('::CASE ')) {
      const id = Number.parseInt(line.split('::CASE ')[1] ?? '', 10);
      current = { testCaseId: Number.isFinite(id) ? id : -1, exitCode: 0, runtimeMs: 0, stdout: '', stderr: '' };
      cases.push(current);
      continue;
    }
    if (line.includes('::COMPILE_EXIT ')) {
      compileExitCode = Number.parseInt(line.split('::COMPILE_EXIT ')[1] ?? '', 10);
      continue;
    }
    if (line.includes('::COMPILE_B64 ')) {
      compileOutput = decode(line.split('::COMPILE_B64 ')[1] ?? '');
      continue;
    }
    if (!current) continue;
    if (line.includes('::EXIT ')) {
      current.exitCode = Number.parseInt(line.split('::EXIT ')[1] ?? '0', 10);
    } else if (line.includes('::MS ')) {
      current.runtimeMs = Number.parseInt(line.split('::MS ')[1] ?? '0', 10);
    } else if (line.includes('::STDOUT_B64 ')) {
      current.stdout = decode(line.split('::STDOUT_B64 ')[1] ?? '');
    } else if (line.includes('::STDERR_B64 ')) {
      current.stderr = decode(line.split('::STDERR_B64 ')[1] ?? '');
    }
  }

  return { compileExitCode, compileOutput, cases, completed: text.includes('::DONE') };
}

export class UnshareExecutor implements CodeExecutor {
  readonly kind = 'local' as const;

  private readonly unsharePath: string;
  private readonly timeoutPath: string;
  private readonly compiler: { command: string; source: string };

  constructor() {
    this.unsharePath = findUnshare() ?? 'unshare';
    const compiler = resolveCompiler();
    if (!compiler) throw new Error('UnshareExecutor requires a C compiler on the host');
    this.compiler = compiler;
    for (const binary of ['/usr/bin/timeout', '/usr/bin/prlimit', '/usr/bin/mount', '/usr/bin/date']) {
      if (!fs.existsSync(binary)) throw new Error(`UnshareExecutor requires ${binary} (util-linux / coreutils)`);
    }
    this.timeoutPath = '/usr/bin/timeout';
  }

  static available(): boolean {
    return process.platform === 'linux' && findUnshare() !== null;
  }

  static resolve(): UnshareExecutor | null {
    if (!UnshareExecutor.available()) return null;
    try {
      return new UnshareExecutor();
    } catch {
      return null;
    }
  }

  async isAvailable(): Promise<boolean> {
    const probe = spawnSync(this.unsharePath, ['--user', '--map-root-user', 'true'], {
      windowsHide: true,
      encoding: 'utf8',
    });
    return probe.status === 0;
  }

  async execute(request: ExecuteRequest): Promise<ExecutionOutcome> {
    const root = scratchRoot();
    fs.mkdirSync(root, { recursive: true });
    const scratch = path.join(root, `sub-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`);
    fs.mkdirSync(scratch, { recursive: true });

    try {
      // Inputs the sandbox may read (never write: root is remounted read-only).
      const inputsDir = path.join(scratch, 'inputs');
      const casesDir = path.join(inputsDir, 'cases');
      fs.mkdirSync(casesDir, { recursive: true });
      const files = request.files?.length ? request.files : [{ filename: 'code.c', content: request.code }];
      const entryFile = request.entryFile ?? 'code.c';
      for (const file of files) fs.writeFileSync(path.join(inputsDir, file.filename), file.content, 'utf8');
      const sourceFiles = files
        .filter((file) => file.filename.toLowerCase().endsWith('.c') && (file.filename === entryFile || file.autoInclude !== false))
        .sort((a, b) => Number(b.filename === entryFile) - Number(a.filename === entryFile))
        .map((file) => `${inputsDir}/${file.filename}`)
        .join(' ');
      for (const testCase of request.testCases) {
        fs.writeFileSync(path.join(casesDir, `${testCase.id}.in`), testCase.inputData, 'utf8');
      }

      const runnerScript = RUNNER.replaceAll('{COMPILER_FLAGS}', config.executor.compilerFlags.join(' '))
        .replaceAll('{LINK_FLAGS}', config.executor.linkFlags.join(' '))
        .replaceAll('{INPUTS_DIR}', inputsDir)
        .replaceAll('{SOURCE_FILES}', sourceFiles)
        .replaceAll('{MAX_OUTPUT_BYTES}', String(request.limits.maxOutputBytes))
        .replaceAll('{MEMORY_BYTES}', String(Math.round(request.limits.memoryLimitMb * 1024 * 1024)))
        .replaceAll('{CPU_SECONDS}', String(Math.max(request.limits.timeLimitMs / 1000, 1)))
        .replaceAll('{PIDS_LIMIT}', String(Math.max(request.limits.pidsLimit, 1)))
        .replaceAll('{TIME_SECONDS}', (request.limits.timeLimitMs / 1000).toFixed(2));
      fs.writeFileSync(path.join(scratch, 'run.sh'), runnerScript, 'utf8');

      // One unshare session for the whole submission: compile once, then run
      // every case inside the same private namespace tree.
      const budgetMs =
        config.executor.compileTimeoutMs + request.limits.timeLimitMs * Math.max(request.testCases.length, 1) + 5_000;

      const proc = await runProcess({
        command: this.unsharePath,
        args: [
          '--user',
          '--map-root-user',
          '--mount',
          '--pid',
          '--fork',
          '--kill-child=SIGKILL',
          '--mount-proc=/proc',
          '--net',
          '/bin/sh',
          path.join(scratch, 'run.sh'),
        ],
        cwd: scratch,
        timeoutMs: budgetMs,
        maxOutputBytes: request.limits.maxOutputBytes * 4,
      });

      const parsed = parseRunnerOutput(proc.stdout);

      if (proc.timedOut || (!parsed.completed && proc.exitCode === null)) {
        return {
          compiled: false,
          compilationError: proc.timedOut
            ? 'Sandbox exceeded its total time budget and was terminated.'
            : 'Sandbox produced no result.',
          compilerOutput: truncate(`${proc.stdout}\n${proc.stderr}`, request.limits.maxOutputBytes),
          runs: [],
          executor: this.kind,
        };
      }

      // The runner exits non-zero only on its own setup failures (90-93).
      if (!parsed.completed) {
        const setupError = proc.exitCode !== null && proc.exitCode >= 90 && proc.exitCode <= 93;
        return {
          compiled: false,
          compilationError: setupError
            ? `Sandbox setup failed (exit ${proc.exitCode}): ${truncate(proc.stderr, 300)}`
            : `Sandbox runner did not finish (exit ${proc.exitCode ?? 'signal'}). ${truncate(proc.stderr, 300)}`,
          compilerOutput: truncate(proc.stdout, request.limits.maxOutputBytes),
          runs: [],
          executor: this.kind,
        };
      }

      if (parsed.compileExitCode === null) {
        return {
          compiled: false,
          compilationError: 'Sandbox runner failed before compilation.',
          compilerOutput: truncate(proc.stderr, request.limits.maxOutputBytes),
          runs: [],
          executor: this.kind,
        };
      }

      if (parsed.compileExitCode !== 0) {
        return {
          compiled: false,
          compilationError: truncate(
            parsed.compileOutput || 'Compilation failed for an unknown reason.',
            request.limits.maxOutputBytes,
          ),
          compilerOutput: parsed.compileOutput,
          runs: [],
          executor: this.kind,
        };
      }

      const byId = new Map(parsed.cases.map((entry) => [entry.testCaseId, entry]));
      const runs: TestCaseRun[] = request.testCases.map((testCase) => {
        const result = byId.get(testCase.id);
        if (!result) {
          return {
            testCaseId: testCase.id,
            passed: false,
            errorType: 'RUNTIME_ERROR' as ErrorType,
            actualOutput: '',
            stderr: 'Test case did not produce a result inside the sandbox.',
            runtimeMs: 0,
            memoryUsedMb: null,
          };
        }

        const comparison = compareOutput(testCase.expectedOutput, result.stdout);
        const errorType = classifyProcessOutcome({
          exitCode: result.exitCode,
          timedOut: result.exitCode === 137 || result.exitCode === 124,
          stderr: result.stderr,
          stdoutMatched: comparison.passed,
        });

        return {
          testCaseId: testCase.id,
          passed: errorType === 'PASS',
          errorType,
          actualOutput: truncate(result.stdout, request.limits.maxOutputBytes),
          stderr: truncate(result.stderr, request.limits.maxOutputBytes),
          runtimeMs: result.runtimeMs,
          memoryUsedMb: null,
        };
      });

      return {
        compiled: true,
        compilationError: null,
        compilerOutput: parsed.compileOutput,
        runs,
        executor: this.kind,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ err: message }, 'unshare executor failed');
      return {
        compiled: false,
        compilationError: `Sandbox error: ${message}`,
        compilerOutput: '',
        runs: [],
        executor: this.kind,
      };
    } finally {
      removeScratchDir(scratch);
    }
  }
}
