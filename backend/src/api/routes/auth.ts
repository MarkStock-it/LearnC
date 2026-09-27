import { Router } from 'express';
import { z } from 'zod';
import * as authRepo from '../../db/authRepositories.js';
import * as repo from '../../db/repositories.js';
import { logger } from '../../utils/logger.js';
import { ApiError, asyncHandler, parseWith } from '../http.js';
import { requireUser } from '../middleware/currentUser.js';

export const authRouter = Router();

const credentialsSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, 'Username must be at least 3 characters')
    .max(40)
    .regex(/^[a-zA-Z0-9_.-]+$/, 'Use letters, numbers, dots, dashes or underscores'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(200),
});

/** POST /api/auth/register — create an account with a password. */
authRouter.post(
  '/register',
  asyncHandler(async (req, res) => {
    const body = parseWith(credentialsSchema, req.body, 'request body');

    const existing = (await (await import('../../db/knex.js')).db()('users')
      .where({ username: body.username })
      .first()) as { id: number } | undefined;
    if (existing) {
      throw ApiError.badRequest('That username is already taken');
    }
    if (existing === undefined) {
      const settings = await authRepo.getSettings(0).catch(() => null); // warm-up noop
      void settings;
    }

    const userId = await authRepo.findOrCreateUserId(body.username);
    // findOrCreateUserId returns the existing id when the username is taken;
    // the existence check above already rejected that case.
    await authRepo.setPassword(userId, body.password);
    const token = authRepo.issueToken(userId);
    logger.info({ userId, username: body.username }, 'account registered');
    res.status(201).json({ token, user: await repo.findUser(userId) });
  }),
);

/** POST /api/auth/login — verify credentials and issue a session token. */
authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const body = parseWith(credentialsSchema, req.body, 'request body');

    const conn = (await import('../../db/knex.js')).db();
    const row = (await conn('users').where({ username: body.username }).first()) as { id: number } | undefined;
    if (!row) throw ApiError.unauthorized('Wrong username or password');

    const stored = await authRepo.getPasswordHash(row.id);
    if (!stored) {
      // Legacy account that has only ever used the shared-name flow.
      throw ApiError.unauthorized('This account has no password yet — register to set one');
    }
    const ok = await authRepo.verifyPassword(body.password, stored);
    if (!ok) throw ApiError.unauthorized('Wrong username or password');

    const token = authRepo.issueToken(row.id);
    logger.info({ userId: row.id, username: body.username }, 'user logged in');
    res.json({ token, user: await repo.findUser(row.id) });
  }),
);

/** POST /api/auth/logout — revoke the presented token. */
authRouter.post('/logout', (req, res) => {
  const header = req.header('authorization');
  if (header?.toLowerCase().startsWith('bearer ')) {
    authRepo.revokeToken(header.slice(7).trim());
  }
  res.status(204).end();
});

/** GET /api/auth/me — who am I + AI settings summary. */
authRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const settings = await authRepo.getSettings(user.id);
    res.json({ user, ai: settings });
  }),
);

const aiSettingsSchema = z.object({
  provider: z.enum(['server', 'gemini']),
  geminiApiKey: z.string().trim().max(200).optional(),
});

/** PUT /api/auth/ai-settings — store or clear the Gemini key / provider choice. */
authRouter.put(
  '/ai-settings',
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const body = parseWith(aiSettingsSchema, req.body, 'request body');

    if (body.provider === 'gemini') {
      const key = body.geminiApiKey ?? (await authRepo.getGeminiKey(user.id));
      if (!key || key.length < 10) {
        throw ApiError.badRequest('A Gemini API key is required to use Gemini');
      }
      await authRepo.setGeminiKey(user.id, key);
      await authRepo.setAiProvider(user.id, 'gemini');
    } else {
      await authRepo.setAiProvider(user.id, 'server');
    }

    res.json({ ai: await authRepo.getSettings(user.id) });
  }),
);

/** DELETE /api/auth/ai-settings/gemini-key — remove the stored key. */
authRouter.delete(
  '/ai-settings/gemini-key',
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    await authRepo.setGeminiKey(user.id, null);
    res.json({ ai: await authRepo.getSettings(user.id) });
  }),
);
