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

/**
 * Columns that a later migration adds. Checking table *names* alone is not enough: on a
 * database that predates migration 003, every required table exists, so a name-only guard
 * passes, the process reports healthy, and then most endpoints return 500 at request time
 * because the query references a column that is not there. These are checked by name too,
 * so that failure happens at boot where it can be seen.
 */
const REQUIRED_COLUMNS: Record<string, string[]> = {
  problem_sets: ['user_id', 'is_public', 'published_at', 'published_by', 'orphaned'],
  user_settings: ['leaderboard_public'],
};

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
      `Database schema is incomplete (missing tables: ${missing.join(', ')}). Run \`npm run db:migrate\` first.`,
    );
  }

  const missingColumns: string[] = [];
  for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
    for (const column of columns) {
      if (!(await conn.schema.hasColumn(table, column))) missingColumns.push(`${table}.${column}`);
    }
  }
  if (missingColumns.length > 0) {
    throw new Error(
      `Database schema is behind this build (missing columns: ${missingColumns.join(', ')}). ` +
        'A migration is pending — run `npm run db:migrate` before serving traffic.',
    );
  }

  logger.debug({ tables: required.length, columns: missingColumns.length }, 'schema verified');
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
