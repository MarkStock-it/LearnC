import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { config, resolveCompiler } from '../../config.js';
import type { ExecutionOutcome } from '../../domain/types.js';
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
 * Dev-mode sandbox: compiles and runs on the host toolchain with a wall-clock
 * timeout and bounded output.
 *
 * SECURITY: this offers no isolation — student code runs with the privileges of the
 * API process. It exists so the platform is runnable without Docker, and is never
 * selected in production (see `executor/index.ts`).
 */
export class LocalExecutor implements CodeExecutor {
  readonly kind = 'local' as const;

  constructor(private readonly compiler: { command: string; source: string }) {}

  /**
   * Toolchains expect their own `bin` on PATH so nested processes (cc1, as, ld)
   * can resolve their DLLs. Without this, gcc exits 1 with no diagnostics.
   */
  private childEnvironment(): NodeJS.ProcessEnv {
    const compilerDir = path.dirname(this.compiler.command);
    const currentPath = process.env.PATH ?? '';
    return {
      ...process.env,
      PATH: currentPath.length > 0 ? `${compilerDir}${path.delimiter}${currentPath}` : compilerDir,
    };
  }

  static resolve(): LocalExecutor | null {
    const compiler = resolveCompiler();
    if (!compiler) return null;
    return new LocalExecutor(compiler);
  }

  async isAvailable(): Promise<boolean> {
    const probe = spawnSync(this.compiler.command, ['--version'], { windowsHide: true, encoding: 'utf8' });
    return probe.status === 0;
  }

  async execute(request: ExecuteRequest): Promise<ExecutionOutcome> {
    const scratch = createScratchDir();
    const isWindows = process.platform === 'win32';
    const sourceFile = path.join(scratch, 'code.c');
    const binaryFile = path.join(scratch, isWindows ? 'program.exe' : 'program');

    try {
      const files = request.files?.length ? request.files : [{ filename: 'code.c', content: request.code }];
      const entryFile = request.entryFile ?? 'code.c';
      for (const file of files) fs.writeFileSync(path.join(scratch, file.filename), file.content, 'utf8');
      if (!files.some((file) => file.filename === entryFile)) fs.writeFileSync(sourceFile, request.code, 'utf8');
      const sourceFiles = files
        .filter((file) => file.filename.toLowerCase().endsWith('.c') && (file.filename === entryFile || file.autoInclude !== false))
        .sort((a, b) => Number(b.filename === entryFile) - Number(a.filename === entryFile))
        .map((file) => path.join(scratch, file.filename));

      const compile = await runProcess({
        command: this.compiler.command,
        args: [
          ...config.executor.compilerFlags,
          ...sourceFiles,
          '-o',
          binaryFile,
          ...config.executor.linkFlags,
        ],
        cwd: scratch,
        timeoutMs: config.executor.compileTimeoutMs,
        maxOutputBytes: request.limits.maxOutputBytes,
        env: this.childEnvironment(),
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

      const runs = [];
      for (const testCase of request.testCases) {
        const proc = await runProcess({
          command: binaryFile,
          args: [],
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
      logger.error({ err: message }, 'local executor failed');
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
