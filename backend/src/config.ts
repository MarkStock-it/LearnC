import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Backend package root: `<repo>/backend` both for `src/` (tsx) and `dist/` (node). */
export const BACKEND_ROOT = path.resolve(here, '..');
export const REPO_ROOT = path.resolve(BACKEND_ROOT, '..');

dotenv.config({ path: path.join(BACKEND_ROOT, '.env'), quiet: true });

function str(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw === undefined || raw === '' ? fallback : raw;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Port with a sanity check: some environments export PORT=0 (or a stray string),
 * which would otherwise bind the API to a random port on every boot.
 */
function port(name: string, fallback: number): number {
  const parsed = int(name, fallback);
  return parsed >= 1 && parsed <= 65_535 ? parsed : fallback;
}

function oneOf<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
  const raw = process.env[name];
  if (raw && (allowed as readonly string[]).includes(raw)) return raw as T;
  return fallback;
}

/** Scan PATH for an executable, mirroring what the shell would resolve. */
function findOnPath(binary: string): string | null {
  const exts = process.platform === 'win32' ? ['', '.exe', '.cmd', '.bat'] : [''];
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, binary + ext);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

const WINDOWS_CANDIDATES = [
  'C:/msys64/ucrt64/bin/gcc.exe',
  'C:/msys64/mingw64/bin/gcc.exe',
  'C:/msys64/clang64/bin/gcc.exe',
  'C:/mingw64/bin/gcc.exe',
  'C:/Program Files/mingw-w64/mingw64/bin/gcc.exe',
];
const POSIX_CANDIDATES = ['/usr/bin/gcc', '/usr/local/bin/gcc', '/usr/bin/cc'];

/**
 * Locate a C compiler. Docker mode does not need a host compiler; local mode does.
 * Returns the full command plus the argument that marks the output file (`-o` for
 * GCC/Clang — the only toolchain the platform targets).
 */
export function resolveCompiler(): { command: string; source: string } | null {
  const configured = process.env.C_COMPILER;
  if (configured) {
    if (fs.existsSync(configured)) return { command: configured, source: 'env:C_COMPILER' };
    const onPath = findOnPath(configured);
    if (onPath) return { command: onPath, source: 'env:C_COMPILER (PATH)' };
    return null;
  }

  const onPath = findOnPath('gcc');
  if (onPath) return { command: onPath, source: 'PATH' };

  for (const candidate of process.platform === 'win32' ? WINDOWS_CANDIDATES : POSIX_CANDIDATES) {
    if (fs.existsSync(candidate)) return { command: candidate, source: 'well-known path' };
  }
  return null;
}

export const config = {
  env: str('NODE_ENV', 'development'),
  isProduction: str('NODE_ENV', 'development') === 'production',
  port: port('PORT', 4000),
  logLevel: str('LOG_LEVEL', 'info'),

  db: {
    /** `better-sqlite3` for zero-infra local dev, `pg` for the Postgres target. */
    client: oneOf('DB_CLIENT', ['better-sqlite3', 'pg'] as const, 'better-sqlite3'),
    sqliteFile: str('DB_FILE', path.join(REPO_ROOT, 'data', 'c-practice.sqlite')),
    databaseUrl: str('DATABASE_URL', 'postgres://postgres:postgres@localhost:5432/c_practice'),
    poolMin: int('DB_POOL_MIN', 2),
    poolMax: int('DB_POOL_MAX', 10),
  },

  queue: {
    /** `inline` runs jobs in-process (no Redis); `bull` is the production path. */
    driver: oneOf('QUEUE_DRIVER', ['inline', 'bull'] as const, 'inline'),
    redisUrl: str('REDIS_URL', 'redis://127.0.0.1:6379'),
    name: 'submissions',
    concurrency: int('QUEUE_CONCURRENCY', 4),
    maxAttempts: int('QUEUE_MAX_ATTEMPTS', 3),
    backoffMs: int('QUEUE_BACKOFF_MS', 750),
  },

  executor: {
    /** `auto` prefers Docker, then user-namespace `unshare`, then the host compiler (dev only). */
    mode: oneOf('EXECUTOR_MODE', ['auto', 'local', 'docker', 'unshare'] as const, 'auto'),
    dockerImage: str('EXECUTOR_DOCKER_IMAGE', 'c-practice-runner:latest'),
    /** Hard wall-clock cap per test case (plan §6.1). */
    timeLimitMs: int('EXECUTOR_TIME_LIMIT_MS', 5000),
    compileTimeoutMs: int('EXECUTOR_COMPILE_TIMEOUT_MS', 20000),
    memoryLimitMb: int('EXECUTOR_MEMORY_MB', 256),
    pidsLimit: int('EXECUTOR_PIDS_LIMIT', 64),
    cpuLimit: Number(str('EXECUTOR_CPU_LIMIT', '1')),
    maxOutputBytes: int('EXECUTOR_MAX_OUTPUT_BYTES', 64 * 1024),
    /** Parallel submissions allowed to run at once. */
    concurrency: int('EXECUTOR_CONCURRENCY', 2),
    compilerFlags: ['-Wall', '-Wextra', '-std=c99', '-O2'],
    /** Appended after the source file so libm links on glibc/mingw both. */
    linkFlags: ['-lm'],
  },

  ai: {
    /** `offline` uses the curated problem bank so the platform works without a key. */
    provider: oneOf('AI_PROVIDER', ['anthropic', 'offline', 'openai-compat'] as const, 'offline'),
    apiKey: str('ANTHROPIC_API_KEY', ''),
    model: str('AI_MODEL', str('ANTHROPIC_MODEL', 'claude-3-5-sonnet-20241022')),
    /** OpenAI-compatible endpoint for `openai-compat` (e.g. a llama.cpp server). */
    baseUrl: str('AI_BASE_URL', 'http://127.0.0.1:11434/v1'),
    maxAttempts: int('AI_MAX_ATTEMPTS', 3),
  },

  http: {
    maxCodeBytes: int('MAX_CODE_BYTES', 64 * 1024),
    maxBodyBytes: str('MAX_BODY_SIZE', '256kb'),
    adminToken: str('ADMIN_TOKEN', ''),
  },
} as const;

export type Config = typeof config;
