import { Router } from 'express';
import { db } from '../../db/knex.js';
import { asyncHandler, parseWith } from '../http.js';
import { requireAuthenticatedUser } from '../middleware/currentUser.js';
import { z } from 'zod';

export const leaderboardSettingsRouter = Router();

const settingsSchema = z.object({ isPublic: z.boolean() });

leaderboardSettingsRouter.put(
  '/',
  asyncHandler(async (req, res) => {
    const user = requireAuthenticatedUser(req);
    const { isPublic } = parseWith(settingsSchema, req.body, 'request body');
    const conn = db();

    await conn('user_settings').insert({ user_id: user.id }).onConflict('user_id').ignore();
    await conn('user_settings').where({ user_id: user.id }).update({
      leaderboard_public: isPublic,
      updated_at: conn.fn.now(),
    });

    const settings = await conn('user_settings')
      .select('password_hash', 'gemini_api_key', 'ai_provider', 'leaderboard_public')
      .where({ user_id: user.id })
      .first() as {
        password_hash: string | null;
        gemini_api_key: string | null;
        ai_provider: string;
        leaderboard_public: boolean;
      } | undefined;

    res.json({
      ai: {
        userId: user.id,
        hasPassword: settings?.password_hash !== null && settings?.password_hash !== undefined,
        hasGeminiKey: Boolean(settings?.gemini_api_key),
        aiProvider: settings?.ai_provider === 'gemini' ? 'gemini' : 'server',
        leaderboardPublic: Boolean(settings?.leaderboard_public),
      },
    });
  }),
);
