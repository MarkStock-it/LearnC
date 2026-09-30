import type { NextFunction, Request, RequestHandler, Response } from 'express';
import * as repo from '../../db/repositories.js';
import { ApiError } from '../http.js';

declare module 'express-serve-static-core' {
  interface Request {
    user?: repo.UserRecord;
    sessionAuthenticated?: boolean;
  }
}

/** Legacy middleware name retained as a safe alias: headers and usernames are never identities. */
export function currentUser(): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    req.user = undefined;
    req.sessionAuthenticated = false;
    next();
  };
}

/** Route helper for signed-in identity; it never manufactures a shared guest user. */
export function requireUser(req: Request): repo.UserRecord {
  if (!req.user) throw ApiError.unauthorized('A valid signed-in session is required');
  return req.user;
}

/** User-owned content requires a verified signed session, not guest or legacy identity. */
export function requireAuthenticatedUser(req: Request): repo.UserRecord {
  if (!req.sessionAuthenticated) throw ApiError.unauthorized('A valid signed-in session is required');
  return requireUser(req);
}
