import { migrateDown } from '../db/migrations/index.js';
import { closeDb } from '../db/knex.js';
import { logger } from '../utils/logger.js';

const stepsArg = process.argv.find((arg) => arg.startsWith('--steps='));
const steps = stepsArg ? Number.parseInt(stepsArg.split('=')[1] ?? '1', 10) : 1;

try {
  const rolledBack = await migrateDown(undefined, Number.isFinite(steps) && steps > 0 ? steps : 1);
  logger.info({ rolledBack }, rolledBack.length > 0 ? 'rollback complete' : 'nothing to roll back');
} catch (error) {
  logger.fatal({ err: error instanceof Error ? error.message : String(error) }, 'rollback failed');
  process.exitCode = 1;
} finally {
  await closeDb();
}
