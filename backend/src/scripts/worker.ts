import { config } from '../config.js';
import { assertSchemaReady, closeDb } from '../db/knex.js';
import { assertMigrationsApplied } from '../db/migrations/index.js';
import { startQueue, stopQueue } from '../queue/index.js';
import { executorHealth } from '../services/executor/index.js';
import { logger } from '../utils/logger.js';

/**
 * Standalone worker for the Bull driver (plan §8.1: scale workers independently of
 * the API). With QUEUE_DRIVER=inline the API already runs jobs in-process, so this
 * entrypoint is only useful for Bull.
 */
async function main(): Promise<void> {
  await assertMigrationsApplied();
  await assertSchemaReady();

  const sandbox = await executorHealth();
  logger.info({ sandbox: sandbox.kind, available: sandbox.available, detail: sandbox.detail }, 'worker sandbox status');

  await startQueue();
  logger.info(
    { driver: config.queue.driver, concurrency: config.queue.concurrency, redis: config.queue.redisUrl },
    'worker started',
  );

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'worker shutting down');
    void stopQueue()
      .then(closeDb)
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error: unknown) => {
  logger.fatal({ err: error instanceof Error ? error.message : String(error) }, 'worker failed to start');
  process.exit(1);
});
