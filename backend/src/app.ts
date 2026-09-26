import express, { type Express } from 'express';
import cors from 'cors';
import { pinoHttp } from 'pino-http';
import { config } from './config.js';
import { logger } from './utils/logger.js';
import { errorHandler, notFoundHandler } from './api/http.js';
import { currentUser } from './api/middleware/currentUser.js';
import { healthRouter } from './api/routes/health.js';
import { problemSetsRouter } from './api/routes/problemSets.js';
import { problemsRouter } from './api/routes/problems.js';
import { submissionsRouter } from './api/routes/submissions.js';
import { dashboardRouter } from './api/routes/dashboard.js';
import { adminRouter } from './api/routes/admin.js';

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (req) => req.url === '/api/health' },
    }),
  );
  // Dev-friendly CORS. Tightening this to the deployed frontend origin is a
  // deployment concern (plan §8.2).
  app.use(cors({ exposedHeaders: ['x-request-id'] }));
  app.use(express.json({ limit: config.http.maxBodyBytes }));

  app.get('/', (_req, res) => {
    res.json({ name: 'c-practice-api', version: '0.1.0', docs: '/api/health' });
  });

  app.use('/api/health', healthRouter);
  app.use('/api/problem-sets', problemSetsRouter);
  app.use('/api/admin', adminRouter);

  // Identity is only resolved where per-user data is needed.
  app.use('/api/problems', currentUser(), problemsRouter);
  app.use('/api/submissions', currentUser(), submissionsRouter);
  app.use('/api/dashboard', currentUser(), dashboardRouter);

  app.use(notFoundHandler());
  app.use(errorHandler());

  return app;
}
