import { migrateUp } from '../db/migrations/index.js';
import { closeDb } from '../db/knex.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

/**
 * The database these migrations actually ran against.
 *
 * The old expression handled Postgres and otherwise fell through to `sqliteFile`, so a
 * MySQL deploy logged a SQLite path — during a production run that reads as if the
 * migrations had gone to the wrong database entirely.
 */
function migrationTarget(): string {
  if (config.db.client === 'pg') return config.db.databaseUrl;
  if (config.db.client === 'mysql') {
    return `${config.db.user}@${config.db.host}:${config.db.port}/${config.db.database}`;
  }
  return config.db.sqliteFile;
}

try {
  const applied = await migrateUp();
  logger.info(
    { client: config.db.client, applied, target: migrationTarget() },
    applied.length > 0 ? 'migrations applied' : 'database already up to date',
  );
} catch (error) {
  logger.fatal({ err: error instanceof Error ? error.message : String(error) }, 'migration failed');
  process.exitCode = 1;
} finally {
  await closeDb();
}
