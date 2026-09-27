import fs from 'node:fs';
import path from 'node:path';
import knex, { type Knex } from 'knex';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

let instance: Knex | null = null;

function createKnex(): Knex {
  if (config.db.client === 'pg') {
    return knex({
      client: 'pg',
      connection: config.db.databaseUrl,
      pool: { min: config.db.poolMin, max: config.db.poolMax },
      acquireConnectionTimeout: 10_000,
    });
  }

  if (config.db.client === 'mysql') {
    return knex({
      client: 'mysql2',
      connection: {
        host: config.db.host,
        port: config.db.port,
        user: config.db.user,
        password: config.db.password,
        database: config.db.database,
        charset: 'utf8mb4',
      },
      pool: { min: config.db.poolMin, max: config.db.poolMax },
      acquireConnectionTimeout: 10_000,
    });
  }

  fs.mkdirSync(path.dirname(config.db.sqliteFile), { recursive: true });
  return knex({
    client: 'better-sqlite3',
    connection: { filename: config.db.sqliteFile },
    useNullAsDefault: true,
    pool: { min: 1, max: 1 },
  });
}

export function db(): Knex {
  if (!instance) instance = createKnex();
  return instance;
}

export async function closeDb(): Promise<void> {
  if (instance) {
    await instance.destroy();
    instance = null;
  }
}

/** Fail fast at boot if the schema has not been migrated yet. */
export async function assertSchemaReady(): Promise<void> {
  const conn = db();
  const required = [
    'users',
    'problem_sets',
    'problems',
    'test_cases',
    'submissions',
    'submission_results',
  ];
  const missing: string[] = [];
  for (const table of required) {
    if (!(await conn.schema.hasTable(table))) missing.push(table);
  }
  if (missing.length > 0) {
    throw new Error(
      `Database schema is incomplete (missing: ${missing.join(', ')}). Run \`npm run db:migrate\` first.`,
    );
  }
  logger.debug({ tables: required.length }, 'schema verified');
}

/**
 * JSON columns come back as objects on Postgres (jsonb), strings on SQLite/MySQL2
 * (mysql2 can also return objects for JSON columns depending on driver options —
 * handle both) — unify them for the repositories.
 */
export function parseJsonColumn<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'object') return value as T;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return fallback;
}
