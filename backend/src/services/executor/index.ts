import { config, resolveCompiler } from '../../config.js';
import { logger } from '../../utils/logger.js';
import { Semaphore } from '../../utils/semaphore.js';
import type { CodeExecutor, ExecuteRequest } from './executor.js';
import { DockerExecutor } from './dockerExecutor.js';
import { UnshareExecutor } from './unshareExecutor.js';
import { LocalExecutor } from './localExecutor.js';

/** Decorator that bounds how many submissions run at once (plan §6.2). */
class LimitedExecutor implements CodeExecutor {
  private readonly semaphore: Semaphore;

  constructor(
    private readonly inner: CodeExecutor,
    concurrency: number,
  ) {
    this.semaphore = new Semaphore(Math.max(1, concurrency));
  }

  get kind(): 'docker' | 'local' {
    return this.inner.kind;
  }

  isAvailable(): Promise<boolean> {
    return this.inner.isAvailable();
  }

  execute(request: ExecuteRequest) {
    return this.semaphore.run(() => this.inner.execute(request));
  }
}

export interface ExecutorResolution {
  executor: CodeExecutor;
  kind: 'docker' | 'local';
  dockerAvailable: boolean;
  compilerPath: string | null;
  reason: string;
}

let resolved: Promise<ExecutorResolution> | null = null;

async function resolve(): Promise<ExecutorResolution> {
  const compiler = resolveCompiler();
  const docker = new DockerExecutor();
  const unshare = UnshareExecutor.resolve();
  const dockerAvailable = config.executor.mode === 'local' ? false : await docker.isAvailable();
  const wrap = (executor: CodeExecutor): ExecutorResolution => ({
    executor: new LimitedExecutor(executor, config.executor.concurrency),
    kind: executor.kind,
    dockerAvailable,
    compilerPath: compiler?.command ?? null,
    reason: '',
  });

  if (config.executor.mode === 'docker') {
    if (!dockerAvailable) {
      throw new Error(
        'EXECUTOR_MODE=docker but the Docker daemon is unreachable. Start Docker, or set EXECUTOR_MODE=unshare (Linux) or EXECUTOR_MODE=local for development.',
      );
    }
    logger.info({ image: config.executor.dockerImage }, 'using Docker sandbox executor');
    return { ...wrap(docker), reason: 'EXECUTOR_MODE=docker' };
  }

  if (config.executor.mode === 'unshare') {
    if (!unshare) {
      throw new Error(
        'EXECUTOR_MODE=unshare requires Linux with unshare(1) and a C compiler. This platform cannot provide the user-namespace sandbox.',
      );
    }
    if (!(await unshare.isAvailable())) {
      throw new Error('EXECUTOR_MODE=unshare but creating a user namespace failed (see server logs).');
    }
    logger.info('using user-namespace (unshare) sandbox executor');
    return { ...wrap(unshare), reason: 'EXECUTOR_MODE=unshare' };
  }

  if (config.executor.mode === 'local') {
    const local = LocalExecutor.resolve();
    if (!local) throw new Error('EXECUTOR_MODE=local but no C compiler was found. Set C_COMPILER to its path.');
    if (config.isProduction) {
      throw new Error(
        'Refusing to run student code on the host in production. Set EXECUTOR_MODE=unshare (Linux) or EXECUTOR_MODE=docker (plan §6.1).',
      );
    }
    logger.warn({ compiler: compiler?.command, source: compiler?.source }, 'using LOCAL executor — no isolation');
    return { ...wrap(local), reason: 'EXECUTOR_MODE=local' };
  }

  // auto — Docker first, then the user-namespace sandbox, then the host compiler.
  if (dockerAvailable) {
    logger.info({ image: config.executor.dockerImage }, 'using Docker sandbox executor');
    return { ...wrap(docker), reason: 'auto: docker daemon reachable' };
  }

  if (unshare && (await unshare.isAvailable())) {
    logger.info('using user-namespace (unshare) sandbox executor');
    return { ...wrap(unshare), reason: 'auto: docker unavailable, using user-namespace sandbox' };
  }

  const local = LocalExecutor.resolve();
  if (!local) {
    throw new Error(
      'No sandbox available: the Docker daemon is unreachable, no user-namespace sandbox, and no C compiler was found. ' +
        'Start Docker, install gcc, or check that unshare(1) is available.',
    );
  }
  if (config.isProduction) {
    throw new Error(
      'Production requires an isolated sandbox (plan §6.1); refusing to fall back to the host compiler. Set EXECUTOR_MODE=unshare (Linux) or EXECUTOR_MODE=docker.',
    );
  }

  logger.warn(
    { compiler: compiler?.command },
    'Docker unavailable — falling back to the LOCAL executor (student code runs on the host). Development only.',
  );
  return { ...wrap(local), reason: 'auto: docker unavailable, using local compiler' };
}

/** Cached resolver so availability probing happens once per process. */
export function getExecutor(): Promise<ExecutorResolution> {
  if (!resolved) {
    resolved = resolve().catch((error: unknown) => {
      resolved = null; // allow a later retry (e.g. Docker started after boot)
      throw error;
    });
  }
  return resolved;
}

export async function executorHealth(): Promise<{ kind: string; available: boolean; detail: string }> {
  try {
    const { executor, kind, reason, compilerPath } = await getExecutor();
    const available = await executor.isAvailable();
    return {
      kind,
      available,
      detail: reason || `${kind}${compilerPath ? ` (${compilerPath})` : ''}`,
    };
  } catch (error) {
    return {
      kind: 'none',
      available: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

export type { CodeExecutor, ExecuteRequest } from './executor.js';
export { DockerExecutor } from './dockerExecutor.js';
export { LocalExecutor } from './localExecutor.js';
export { UnshareExecutor } from './unshareExecutor.js';
