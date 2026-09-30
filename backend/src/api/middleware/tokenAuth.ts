import type { Request, RequestHandler } from 'express';
import * as authRepo from '../../db/authRepositories.js';
import * as repo from '../../db/repositories.js';
import { ApiError } from '../http.js';

/** Resolve only a verified signed session; all other requests remain anonymous guests. */
export function resolveUser(): RequestHandler {
  return (req: Request & { user?: repo.UserRecord }, _res, next) => {
    void (async () => {
      try {
        const header = req.header('authorization');
        if (header && !header.toLowerCase().startsWith('bearer ')) {
          throw ApiError.unauthorized('Invalid authentication scheme');
        }
        if (!header) {
          req.user = undefined;
          req.sessionAuthenticated = false;
          next();
          return;
        }

        const credential = header.slice(7).trim();
        const sessionUserId = authRepo.resolveToken(credential);
        if (sessionUserId === null) throw ApiError.unauthorized('Invalid or expired session token');
        const user = await repo.findUser(sessionUserId);
        if (!user) throw ApiError.unauthorized('Invalid or expired session token');
        req.user = user;
        req.sessionAuthenticated = true;
        next();
      } catch (error) {
        next(error);
      }
    })();
  };
}
