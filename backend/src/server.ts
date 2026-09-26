import { createApp } from './app.js';
import { config } from './config.js';
import { assertSchemaReady, closeDb } from './db/knex.js';
import { startQueue, stopQueue } from './queue/index.js';
import { executorHealth } from './services/executor/index.js';
import { logger } from './utils/logger.js';

async function main(): Promise<void> {
  await assertSchemaReady();

  const app = createApp();
  const server = app.listen(config.port, () => {
    logger.info(
      { port: config.port, env: config.env, db: config.db.client, queue: config.queue.driver },
      'API listening',
    );
  });

  const sandbox = await executorHealth();
  if (sandbox.available) {
    logger.info({ sandbox: sandbox.kind, detail: sandbox.detail }, 'sandbox ready');
  } else {
    logger.warn({ detail: sandbox.detail }, 'sandbox unavailable — submissions will fail until this is fixed');
  }

  if (config.queue.driver === 'inline') {
    // In-process worker: fine for a single dev instance, not for a worker fleet.
    await startQueue();
    logger.info('inline queue worker started in-process');
  } else {
    logger.info('QUEUE_DRIVER=bull — run `npm run worker` to process submissions');
  }

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutting down');
    server.close(() => {
      void stopQueue()
        .then(closeDb)
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
    });
    // Do not hang forever on lingering connections.
    setTimeout(() => process.exit(0), 5_000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error: unknown) => {
  logger.fatal({ err: error instanceof Error ? error.message : String(error) }, 'failed to start API');
  process.exit(1);
});
