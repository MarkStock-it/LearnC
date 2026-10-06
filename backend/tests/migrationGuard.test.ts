import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

/**
 * The deploy failure this covers: a database that has every table but none of the columns
 * a later migration adds. The old guard checked table *names* only, so the API started,
 * reported `ok` on `/api/health`, and then returned 500 for most endpoints because the
 * query referenced a column that was not there. Both checks are asserted here, because
 * they are complementary: the ledger check catches a migration that was never run, the
 * column check catches one that ran halfway.
 *
 * This file runs against a database of its own, with nothing applied to it — which is why
 * `DB_FILE` is set before the modules load. `config.ts` reads the environment once, at
 * import, and the test setup file has already run.
 */
const dbFile = path.join(
  os.tmpdir(),
  'c-practice-tests',
  `guard-${process.pid}-${randomBytes(4).toString('hex')}.sqlite`,
);
process.env.DB_FILE = dbFile;

const knexModule = await import('../src/db/knex.js');
const migrationsModule = await import('../src/db/migrations/index.js');

afterAll(async () => {
  await knexModule.closeDb();
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.unlinkSync(`${dbFile}${suffix}`);
    } catch {
      // The file may never have been created; nothing to clean up.
    }
  }
});

describe('boot-time schema guard', () => {
  it('names every pending migration rather than a missing column', async () => {
    expect(await migrationsModule.pendingMigrations()).toEqual([
      '001_init',
      '002_user_settings',
      '003_bundle_ownership',
      '004_leaderboard_opt_in',
    ]);

    await expect(migrationsModule.assertMigrationsApplied()).rejects.toThrow(/004_leaderboard_opt_in/);
    await expect(migrationsModule.assertMigrationsApplied()).rejects.toThrow(/db:migrate/);
  });

  it('does not write to the database just to check it', async () => {
    // `pendingMigrations` reports a missing ledger as "everything is pending". If it went
    // through `ensureTrackingTable` instead, a read-only database user would fail the boot
    // check with a permission error rather than the real message.
    expect(await knexModule.db().schema.hasTable('schema_migrations')).toBe(false);
  });

  it('boots once the migrations have been applied', async () => {
    await migrationsModule.migrateUp();

    expect(await migrationsModule.pendingMigrations()).toEqual([]);
    await expect(migrationsModule.assertMigrationsApplied()).resolves.toBeUndefined();
    await expect(knexModule.assertSchemaReady()).resolves.toBeUndefined();
  });

  it('still fails loudly when a migration is recorded but its column is missing', async () => {
    const conn = knexModule.db();
    await conn.schema.alterTable('user_settings', (t) => t.dropColumn('leaderboard_public'));

    // The ledger says everything is applied, so only the column check can see this.
    await expect(migrationsModule.assertMigrationsApplied()).resolves.toBeUndefined();
    await expect(knexModule.assertSchemaReady()).rejects.toThrow(/user_settings\.leaderboard_public/);
  });
});
