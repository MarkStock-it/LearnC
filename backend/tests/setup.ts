import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

/**
 * Runs before any test module is imported, so `config.ts` picks these up:
 * a throwaway SQLite file, the in-process queue and the host compiler sandbox.
 * Docker is deliberately not required by the test suite.
 */
process.env.NODE_ENV = 'test';
process.env.DB_CLIENT = 'better-sqlite3';
process.env.DB_FILE = path.join(os.tmpdir(), 'c-practice-tests', `test-${process.pid}-${randomBytes(4).toString('hex')}.sqlite`);
process.env.QUEUE_DRIVER = 'inline';
process.env.EXECUTOR_MODE = process.env.EXECUTOR_MODE ?? 'local';
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'silent';
process.env.VITEST_POOL_ID ??= '1';
