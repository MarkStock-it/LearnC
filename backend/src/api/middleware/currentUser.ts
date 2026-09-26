import type { NextFunction, Request, RequestHandler, Response } from 'express';
import * as repo from '../../db/repositories.js';
import { ApiError } from '../http.js';

declare module 'express-serve-static-core' {
  interface Request {
    user?: repo.UserRecord;
  }
}

/**
 * MVP identity resolution. The plan defers real auth (`JWT (optional for MVP)`,
 * with USC CAS integration later), so this resolves a user from:
 *   1. `x-user-id: <id>`
 *   2. `Authorization: Bearer <username>` (created on first use)
 *   3. otherwise the shared `guest` account
 * Every downstream query filters by `req.user.id`, so swapping in JWT later only
 * changes this middleware.
 */
export function currentUser(): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    void (async () => {
      try {
        const headerId = req.header('x-user-id');
        if (headerId !== undefined) {
          const id = Number.parseInt(headerId, 10);
          if (!Number.isFinite(id)) throw ApiError.badRequest('x-user-id must be a number');
          const user = await repo.findUser(id);
          if (!user) throw ApiError.notFound(`User ${id} does not exist`);
          req.user = user;
          next();
          return;
        }

        const auth = req.header('authorization');
        if (auth && auth.toLowerCase().startsWith('bearer ')) {
          const username = auth.slice(7).trim();
          if (username.length === 0) throw ApiError.unauthorized('Bearer token must carry a username');
          req.user = await repo.ensureUser(username);
          next();
          return;
        }

        req.user = await repo.ensureUser('guest');
        next();
      } catch (error) {
        next(error);
      }
    })();
  };
}

/** Route helper: `currentUser()` guarantees this, but keeps types honest. */
export function requireUser(req: Request): repo.UserRecord {
  if (!req.user) throw ApiError.unauthorized('No user resolved for this request');
  return req.user;
}
