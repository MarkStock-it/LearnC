import { migrateUp } from '../db/migrations/index.js';
import { closeDb } from '../db/knex.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

try {
  const applied = await migrateUp();
  logger.info(
    { client: config.db.client, applied, target: config.db.client === 'pg' ? config.db.databaseUrl : config.db.sqliteFile },
    applied.length > 0 ? 'migrations applied' : 'database already up to date',
  );
} catch (error) {
  logger.fatal({ err: error instanceof Error ? error.message : String(error) }, 'migration failed');
  process.exitCode = 1;
} finally {
  await closeDb();
}
