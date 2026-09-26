import type { Knex } from 'knex';
import { db, closeDb } from '../knex.js';
import { logger } from '../../utils/logger.js';
import * as init from './001_init.js';

/**
 * Minimal migration runner. The plan allows Flyway/Knex migrations; Knex's CLI is
 * awkward with TypeScript + ESM, so migrations are plain modules listed here in
 * application order and tracked in `schema_migrations`.
 */
export const MIGRATIONS: Array<{ name: string; up: (knex: Knex) => Promise<void>; down: (knex: Knex) => Promise<void> }> = [
  init,
];

const TRACKING_TABLE = 'schema_migrations';

async function ensureTrackingTable(knex: Knex): Promise<void> {
  const exists = await knex.schema.hasTable(TRACKING_TABLE);
  if (!exists) {
    await knex.schema.createTable(TRACKING_TABLE, (t) => {
      t.increments('id').primary();
      t.string('name', 255).notNullable().unique();
      t.timestamp('applied_at').notNullable().defaultTo(knex.fn.now());
    });
  }
}

export async function appliedMigrations(knex: Knex): Promise<string[]> {
  await ensureTrackingTable(knex);
  const rows = await knex<{ name: string }>(TRACKING_TABLE).select('name').orderBy('id', 'asc');
  return rows.map((row) => row.name);
}

export async function migrateUp(knex: Knex = db()): Promise<string[]> {
  await ensureTrackingTable(knex);
  const done = new Set(await appliedMigrations(knex));
  const executed: string[] = [];

  for (const migration of MIGRATIONS) {
    if (done.has(migration.name)) continue;
    logger.info({ migration: migration.name }, 'applying migration');
    await migration.up(knex);
    await knex(TRACKING_TABLE).insert({ name: migration.name });
    executed.push(migration.name);
  }
  return executed;
}

export async function migrateDown(knex: Knex = db(), steps = 1): Promise<string[]> {
  const done = await appliedMigrations(knex);
  const rolledBack: string[] = [];

  for (let i = 1; i <= steps; i += 1) {
    const last = done[done.length - 1];
    if (!last) break;
    const migration = MIGRATIONS.find((m) => m.name === last);
    if (!migration) throw new Error(`Migration ${last} is recorded but not present in MIGRATIONS`);
    logger.info({ migration: migration.name }, 'rolling back migration');
    await migration.down(knex);
    await knex(TRACKING_TABLE).where({ name: migration.name }).delete();
    rolledBack.push(migration.name);
    done.pop();
  }
  return rolledBack;
}

/** Used by scripts and tests: `migrateUp()` then cleanly release the pool. */
export async function migrate(): Promise<void> {
  const executed = await migrateUp();
  logger.info({ applied: executed.length }, 'migrations complete');
  await closeDb();
}
