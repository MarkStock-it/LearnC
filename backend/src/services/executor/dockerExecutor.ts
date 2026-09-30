import fs from 'node:fs';
import path from 'node:path';
import { config } from '../../config.js';
import type { ExecutionOutcome, TestCaseRun, ErrorType } from '../../domain/types.js';
import { classifyProcessOutcome, compareOutput, truncate } from '../evaluationService.js';
import { logger } from '../../utils/logger.js';
import {
  createScratchDir,
  removeScratchDir,
  type CodeExecutor,
  type ExecuteRequest,
} from './executor.js';

interface DockerModule {
  default: new (options?: Record<string, unknown>) => unknown;
}

interface ContainerLike {
  id: string;
  start(): Promise<void>;
  wait(): Promise<{ StatusCode: number }>;
  logs(options: Record<string, unknown>): Promise<unknown>;
  kill(): Promise<void>;
  remove(options?: Record<string, unknown>): Promise<void>;
}

interface DockerLike {
  ping(): Promise<unknown>;
  createContainer(options: Record<string, unknown>): Promise<ContainerLike>;
}

/**
 * The container side of the protocol. The host mounts only *inputs* read-only and
 * the script writes its scratch files inside the container's own layer, which keeps
 * it working regardless of bind-mount ownership. Results come back as base64 lines
 * on stdout, so no tar/docker-cp plumbing is needed.
 */
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function buildRunnerScript(timeLimitSeconds: string, maxOutputBytes: number, sourcePaths: string[]): string {
  const sources = sourcePaths.map(shellQuote).join(' ');
  return `#!/bin/sh
cd /work 2>/dev/null || { mkdir -p /work && cd /work; }
echo "::START"
gcc ${config.executor.compilerFlags.join(' ')} -o /work/program ${sources} ${config.executor.linkFlags.join(' ')} > /work/compile.log 2>&1
compile_exit=$?
echo "::COMPILE_EXIT $compile_exit"
echo "::COMPILE_B64 $(head -c ${maxOutputBytes} /work/compile.log | base64 | tr -d '\\n')"
if [ "$compile_exit" -ne 0 ]; then
  echo "::DONE"
  exit 0
fi
for input in /inputs/cases/*.in; do
  [ -e "$input" ] || continue
  id=$(basename "$input" .in)
  started=$(date +%s%N)
  timeout -s KILL ${timeLimitSeconds} /work/program < "$input" > /work/out.txt 2> /work/err.txt
  status=$?
  finished=$(date +%s%N)
  echo "::CASE $id"
  echo "::EXIT $status"
  echo "::MS $(( (finished - started) / 1000000 ))"
  echo "::STDOUT_B64 $(head -c ${maxOutputBytes} /work/out.txt | base64 | tr -d '\\n')"
  echo "::STDERR_B64 $(head -c ${maxOutputBytes} /work/err.txt | base64 | tr -d '\\n')"
done
echo "::DONE"
`;
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

async function streamToText(stream: unknown): Promise<string> {
  if (typeof stream === 'string') return stream;
  if (Buffer.isBuffer(stream)) return stream.toString('utf8');
  if (stream && typeof (stream as AsyncIterable<Buffer>)[Symbol.asyncIterator] === 'function') {
    const chunks: Buffer[] = [];
    for await (const chunk of stream as AsyncIterable<Buffer>) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString('utf8');
  }
  return '';
}

export class DockerExecutor implements CodeExecutor {
  readonly kind = 'docker' as const;
  private docker: DockerLike | null = null;

  constructor(private readonly image: string = config.executor.dockerImage) {}

  private async client(): Promise<DockerLike> {
    if (!this.docker) {
      const mod = (await import('dockerode')) as unknown as DockerModule;
      this.docker = new mod.default() as unknown as DockerLike;
    }
    return this.docker;
  }

  async isAvailable(): Promise<boolean> {
    try {
      await (await this.client()).ping();
      return true;
    } catch {
      return false;
    }
  }

  async execute(request: ExecuteRequest): Promise<ExecutionOutcome> {
    const scratch = createScratchDir();
    const casesDir = path.join(scratch, 'cases');
    fs.mkdirSync(casesDir, { recursive: true });
    const files = request.files?.length ? request.files : [{ filename: 'code.c', content: request.code }];
    const entryFile = request.entryFile ?? 'code.c';
    for (const file of files) fs.writeFileSync(path.join(scratch, file.filename), file.content, 'utf8');
    const sourcePaths = files
      .filter((file) => file.filename.toLowerCase().endsWith('.c') && (file.filename === entryFile || file.autoInclude !== false))
      .sort((a, b) => Number(b.filename === entryFile) - Number(a.filename === entryFile))
      .map((file) => `/inputs/${file.filename}`);
    fs.writeFileSync(
      path.join(scratch, 'run.sh'),
      buildRunnerScript((request.limits.timeLimitMs / 1000).toFixed(2), request.limits.maxOutputBytes, sourcePaths),
      'utf8',
    );
    for (const testCase of request.testCases) {
      fs.writeFileSync(path.join(casesDir, `${testCase.id}.in`), testCase.inputData, 'utf8');
    }

    let container: ContainerLike | null = null;
    const memoryBytes = request.limits.memoryLimitMb * 1024 * 1024;

    try {
      const docker = await this.client();
      container = await docker.createContainer({
        Image: this.image,
        Cmd: ['/bin/sh', '/inputs/run.sh'],
        Tty: true,
        WorkingDir: '/work',
        User: 'runner',
        AttachStdout: false,
        AttachStderr: false,
        HostConfig: {
          // Plan §6.1 resource envelope.
          Memory: memoryBytes,
          MemorySwap: memoryBytes, // no swap: the limit cannot be evaded
          NanoCpus: Math.round(config.executor.cpuLimit * 1_000_000_000),
          PidsLimit: request.limits.pidsLimit,
          NetworkMode: 'none',
          CapDrop: ['ALL'],
          SecurityOpt: ['no-new-privileges'],
          Binds: [`${scratch}:/inputs:ro`],
          AutoRemove: false,
        },
      });

      await container.start();

      const budgetMs =
        config.executor.compileTimeoutMs +
        request.limits.timeLimitMs * Math.max(request.testCases.length, 1) +
        5_000;
      let killedByHost = false;
      const guard = setTimeout(() => {
        killedByHost = true;
        void container?.kill().catch(() => undefined);
      }, budgetMs);

      let statusCode: number | null = null;
      try {
        const result = await container.wait();
        statusCode = result?.StatusCode ?? null;
      } finally {
        clearTimeout(guard);
      }

      const logs = await streamToText(await container.logs({ stdout: true, stderr: true, follow: false }));
      const parsed = parseRunnerOutput(logs);

      if (parsed.compileExitCode === null) {
        return {
          compiled: false,
          compilationError: killedByHost
            ? 'Sandbox exceeded its total time budget and was terminated.'
            : `Sandbox produced no result (container exit ${statusCode ?? 'unknown'}).`,
          compilerOutput: truncate(logs, request.limits.maxOutputBytes),
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
            stderr: killedByHost
              ? 'Sandbox was terminated before this test case ran to completion.'
              : 'Test case did not produce a result.',
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
      const missingImage = /no such image|unable to find image/i.test(message);
      logger.error({ err: message, image: this.image }, 'docker executor failed');
      return {
        compiled: false,
        compilationError: missingImage
          ? `Sandbox image "${this.image}" is not built. Run: docker build -t ${this.image} executor/`
          : `Sandbox error: ${message}`,
        compilerOutput: '',
        runs: [],
        executor: this.kind,
      };
    } finally {
      if (container) {
        await container.remove({ force: true }).catch(() => undefined);
      }
      removeScratchDir(scratch);
    }
  }
}
