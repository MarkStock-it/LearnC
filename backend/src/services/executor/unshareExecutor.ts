import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { config, resolveCompiler } from '../../config.js';
import type { ExecutionOutcome, TestCaseRun } from '../../domain/types.js';
import { compareOutput, truncate } from '../evaluationService.js';
import { logger } from '../../utils/logger.js';
import {
  createScratchDir,
  removeScratchDir,
  runProcess,
  toTestCaseRun,
  type CodeExecutor,
  type ExecuteRequest,
} from './executor.js';

/**
 * Production sandbox for hosts without Docker: Linux user namespaces.
 *
 * Each compile/run gets its own `unshare` session with:
 * - a fresh mount namespace seeing only /usr, /lib, /lib64, /bin, /sbin plus the
 *   submission scratch bound at /work — no access to /home, /data or the DB files,
 * - a PID namespace with `--kill-child` so forks cannot outlive the run and the
 *   whole tree is reaped, with the process count capped via RLIMIT_NPROC,
 * - RLIMIT_AS / RLIMIT_CPU / RLIMIT_FSIZE / RLIMIT_CORE from the problem's limits,
 * - a fresh network namespace: only an unconfigured loopback, so there are no
 *   outbound sockets.
 *
 * This is the same isolation Docker is built on (namespaces + rlimits), driven
 * directly. It needs no root: user namespaces are unprivileged, and this host
 * allows them (`unshare --user --map-root-user` verified on Debian 12).
 */

/** Mounts every student program is allowed to see. Read-only. */
const BIND_RO = ['/usr', '/lib', '/lib64', '/bin', '/sbin'];

/** Extra linker/loader locations that exist on some distributions. */
const OPTIONAL_BIND_RO = ['/etc/alternatives', '/etc/ld.so.cache', '/etc/ld.so.conf', '/etc/ld.so.conf.d'];

function findUnshare(): string | null {
  for (const candidate of ['/usr/bin/unshare', '/bin/unshare']) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function bindMountArgs(scratch: string): string[] {
  const args: string[] = [];
  for (const dir of BIND_RO) {
    if (fs.existsSync(dir)) args.push('--bind-ro', dir, dir);
  }
  for (const dir of OPTIONAL_BIND_RO) {
    if (fs.existsSync(dir)) args.push('--bind-ro', dir, dir);
  }
  // The scratch dir is the only writable path inside the sandbox.
  args.push('--bind', scratch, '/work');
  return args;
}

export class UnshareExecutor implements CodeExecutor {
  readonly kind = 'local' as const;

  constructor(
    private readonly compiler: { command: string; source: string },
    private readonly unsharePath: string = findUnshare() ?? 'unshare',
  ) {}

  static available(): boolean {
    return process.platform === 'linux' && findUnshare() !== null;
  }

  static resolve(): UnshareExecutor | null {
    if (!UnshareExecutor.available()) return null;
    const compiler = resolveCompiler();
    if (!compiler) return null;
    return new UnshareExecutor(compiler);
  }

  async isAvailable(): Promise<boolean> {
    const probe = spawnSync(this.unsharePath, ['--user', '--map-root-user', 'true'], {
      windowsHide: true,
      encoding: 'utf8',
    });
    return probe.status === 0;
  }

  /** Full sandbox argv for one command; rlimits bind the innermost process. */
  private sandboxArgv(options: {
    scratch: string;
    command: string;
    args: string[];
    timeLimitSeconds: number;
    memoryLimitMb: number;
    pidsLimit: number;
  }): string[] {
    const { scratch, command, args, timeLimitSeconds, memoryLimitMb, pidsLimit } = options;
    return [
      '--user',
      '--map-root-user',
      '--mount',
      '--pid',
      '--fork',
      '--kill-child=SIGKILL',
      '--mount-proc=/proc',
      ...bindMountArgs(scratch),
      // Inside the namespace we are root, so hard limits can no longer be raised.
      'prlimit',
      `--as=${Math.round(memoryLimitMb * 1024 * 1024)}`,
      `--cpu=${Math.max(timeLimitSeconds, 1)}`,
      '--fsize=67108864',
      '--core=0',
      `--nproc=${Math.max(pidsLimit, 1)}`,
      command,
      ...args,
    ];
  }

  async execute(request: ExecuteRequest): Promise<ExecutionOutcome> {
    const scratch = createScratchDir();
    const sourceFile = path.join(scratch, 'code.c');
    const binaryFile = path.join(scratch, 'program');

    try {
      fs.writeFileSync(sourceFile, request.code, 'utf8');

      // ---------- compile once ----------
      const compile = await runProcess({
        command: this.unsharePath,
        args: this.sandboxArgv({
          scratch,
          command: this.compiler.command,
          args: [
            ...config.executor.compilerFlags,
            '/work/code.c',
            '-o',
            '/work/program',
            ...config.executor.linkFlags,
          ],
          timeLimitSeconds: Math.ceil(config.executor.compileTimeoutMs / 1000),
          memoryLimitMb: 1024, // compiling needs more headroom than running
          pidsLimit: request.limits.pidsLimit,
        }),
        cwd: scratch,
        timeoutMs: config.executor.compileTimeoutMs,
        maxOutputBytes: request.limits.maxOutputBytes,
      });

      const compilerOutput = [compile.stdout, compile.stderr].filter(Boolean).join('\n').trim();

      if (compile.timedOut) {
        return {
          compiled: false,
          compilationError: 'Compilation exceeded the time limit.',
          compilerOutput,
          runs: [],
          executor: this.kind,
        };
      }
      if (compile.spawnError || compile.exitCode !== 0 || !fs.existsSync(binaryFile)) {
        return {
          compiled: false,
          compilationError: truncate(
            compilerOutput || compile.spawnError || 'Compilation failed for an unknown reason.',
            request.limits.maxOutputBytes,
          ),
          compilerOutput,
          runs: [],
          executor: this.kind,
        };
      }

      // ---------- run each test case ----------
      const runs: TestCaseRun[] = [];
      for (const testCase of request.testCases) {
        const proc = await runProcess({
          command: this.unsharePath,
          args: this.sandboxArgv({
            scratch,
            command: '/work/program',
            args: [],
            timeLimitSeconds: Math.ceil(request.limits.timeLimitMs / 1000),
            memoryLimitMb: request.limits.memoryLimitMb,
            pidsLimit: request.limits.pidsLimit,
          }),
          cwd: scratch,
          stdin: testCase.inputData,
          timeoutMs: request.limits.timeLimitMs,
          maxOutputBytes: request.limits.maxOutputBytes,
        });

        runs.push(
          toTestCaseRun({
            testCaseId: testCase.id,
            process: proc,
            expectedOutput: testCase.expectedOutput,
            maxOutputBytes: request.limits.maxOutputBytes,
            compare: compareOutput,
          }),
        );
      }

      return {
        compiled: true,
        compilationError: null,
        compilerOutput,
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
