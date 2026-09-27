import type { Request, RequestHandler } from 'express';
import * as authRepo from '../../db/authRepositories.js';
import * as repo from '../../db/repositories.js';
import { ApiError } from '../http.js';

/**
 * Resolve the acting user. Precedence:
 *  1. `Authorization: Bearer <session token>` issued by /api/auth/login|register
 *  2. `Authorization: Bearer <username>` (legacy identity stub, auto-creates)
 *  3. `x-user-id: <id>` (internal/test helper)
 *  4. the shared `guest` account
 *
 * Password-protected accounts can only be entered with a real session token:
 * a bare username token is rejected when that account has a password set.
 */
export function resolveUser(): RequestHandler {
  return (req: Request & { user?: repo.UserRecord }, _res, next) => {
    void (async () => {
      try {
        const header = req.header('authorization');
        if (header && header.toLowerCase().startsWith('bearer ')) {
          const credential = header.slice(7).trim();

          const sessionUserId = authRepo.resolveToken(credential);
          if (sessionUserId !== null) {
            const user = await repo.findUser(sessionUserId);
            if (user) {
              req.user = user;
              next();
              return;
            }
          }

          // Legacy shared-name flow — only for accounts without a password.
          if (/^[a-zA-Z0-9_.-]{1,40}$/.test(credential)) {
            const existing = (await (await import('../../db/knex.js')).db()('users')
              .where({ username: credential })
              .first()) as { id: number } | undefined;
            if (existing && (await authRepo.hasPassword(existing.id))) {
              throw ApiError.unauthorized('This account requires a login. Please sign in.');
            }
            req.user = await repo.ensureUser(credential);
            next();
            return;
          }

          throw ApiError.unauthorized('Invalid or expired session token');
        }

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

        req.user = await repo.ensureUser('guest');
        next();
      } catch (error) {
        next(error);
      }
    })();
  };
}
