import { Router } from 'express';
import { config } from '../../config.js';
import { db } from '../../db/knex.js';
import { getQueue } from '../../queue/index.js';
import { executorHealth } from '../../services/executor/index.js';
import { asyncHandler } from '../http.js';

export const healthRouter = Router();

healthRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    let database = 'ok';
    try {
      await db().raw('select 1');
    } catch (error) {
      database = error instanceof Error ? error.message : String(error);
    }

    const sandbox = await executorHealth();
    const queue = getQueue();

    res.json({
      status: database === 'ok' && sandbox.available ? 'ok' : 'degraded',
      version: '0.1.0',
      env: config.env,
      database: { client: config.db.client, status: database },
      queue: { driver: queue.driver, ...queue.stats() },
      sandbox,
    });
  }),
);
