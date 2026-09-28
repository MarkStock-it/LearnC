import express, { type Express } from 'express';
import cors from 'cors';
import { pinoHttp } from 'pino-http';
import { config } from './config.js';
import { logger } from './utils/logger.js';
import { errorHandler, notFoundHandler } from './api/http.js';
import { currentUser } from './api/middleware/currentUser.js';
import { resolveUser } from './api/middleware/tokenAuth.js';
import { authRouter } from './api/routes/auth.js';
import { aiRouter } from './api/routes/ai.js';
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

  // Authentication is open (it resolves identity, it does not guard data),
  // but /api/auth/me reads req.user — resolve identity there too.
  app.use('/api/auth', resolveUser(), authRouter);

  // Identity is only resolved where per-user data is needed. resolveUser is the
  // token-aware superset of the legacy currentUser stub.
  app.use('/api/problems', resolveUser(), problemsRouter);
  app.use('/api/submissions', resolveUser(), submissionsRouter);
  app.use('/api/dashboard', resolveUser(), dashboardRouter);
  app.use('/api/ai', resolveUser(), aiRouter);

  app.use(notFoundHandler());
  app.use(errorHandler());

  return app;
}
