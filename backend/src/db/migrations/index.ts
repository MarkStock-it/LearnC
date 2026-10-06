import type { Knex } from 'knex';
import { db, closeDb } from '../knex.js';
import { logger } from '../../utils/logger.js';
import * as init from './001_init.js';
import * as userSettings from './002_user_settings.js';
import * as bundleOwnership from './003_bundle_ownership.js';
import * as leaderboardOptIn from './004_leaderboard_opt_in.js';

/**
 * Minimal migration runner. The plan allows Flyway/Knex migrations; Knex's CLI is
 * awkward with TypeScript + ESM, so migrations are plain modules listed here in
 * application order and tracked in `schema_migrations`.
 */
export const MIGRATIONS: Array<{ name: string; up: (knex: Knex) => Promise<void>; down: (knex: Knex) => Promise<void> }> = [
  init,
  userSettings,
  bundleOwnership,
  leaderboardOptIn,
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

/**
 * Migrations this build expects that the database has not recorded as applied.
 *
 * Deliberately does not go through `ensureTrackingTable`: a boot-time check must not write
 * to the database, and a missing tracking table only means nothing has been applied yet.
 */
export async function pendingMigrations(knex: Knex = db()): Promise<string[]> {
  if (!(await knex.schema.hasTable(TRACKING_TABLE))) return MIGRATIONS.map((m) => m.name);
  const done = new Set(await appliedMigrations(knex));
  return MIGRATIONS.filter((m) => !done.has(m.name)).map((m) => m.name);
}

/**
 * Fail fast at boot if this build needs migrations the database does not have.
 *
 * Without this the API starts, reports `ok` on `/api/health`, and then returns 500 for
 * every endpoint whose query touches a column the migration was going to add — a deploy
 * that looks successful and is broken per request. Refusing to start is louder and is
 * recoverable by running the documented command.
 */
export async function assertMigrationsApplied(knex: Knex = db()): Promise<void> {
  const pending = await pendingMigrations(knex);
  if (pending.length > 0) {
    throw new Error(
      `Database is ${pending.length} migration(s) behind this build (pending: ${pending.join(', ')}). ` +
        'Run `npm run db:migrate` before serving traffic.',
    );
  }
  logger.debug({ migrations: MIGRATIONS.length }, 'migrations verified');
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
