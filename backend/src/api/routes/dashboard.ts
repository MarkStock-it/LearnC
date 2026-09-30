import { Router } from 'express';
import * as repo from '../../db/repositories.js';
import { db } from '../../db/knex.js';
import { asyncHandler, parseWith } from '../http.js';
import { z } from 'zod';
import { requireAuthenticatedUser } from '../middleware/currentUser.js';

const leaderboardQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});

export const dashboardRouter = Router();

dashboardRouter.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const user = requireAuthenticatedUser(req);
    const [stats, recent] = await Promise.all([
      repo.getUserStats(user.id),
      repo.listSubmissions({ userId: user.id, limit: 5 }),
    ]);

    const successRate =
      stats.completedSubmissions === 0
        ? 0
        : Math.round((stats.solvedProblems / Math.max(stats.attemptedProblems, 1)) * 100) / 100;

    res.json({
      user: { id: user.id, username: user.username },
      stats: {
        ...stats,
        successRate,
      },
      recentSubmissions: recent.map((submission) => ({
        id: submission.id,
        problemId: submission.problemId,
        problemTitle: submission.problemTitle,
        status: submission.status,
        passedCount: submission.passedCount,
        totalCount: submission.totalCount,
        createdAt: submission.createdAt,
      })),
    });
  }),
);

dashboardRouter.get('/leaderboard', asyncHandler(async (req, res) => {
  const page = parseWith(leaderboardQuerySchema, req.query, 'query parameters');
  const rows = await db()('user_settings as settings')
    .join('users as u', 'u.id', 'settings.user_id')
    .where('settings.leaderboard_public', true)
    .select(
      'u.username',
      db().raw(`(
        select count(distinct solved.problem_id)
        from submissions as solved
        where solved.user_id = u.id
          and solved.status = ?
          and solved.passed_count > 0
          and solved.passed_count = solved.total_count
      ) as solvedProblems`, ['COMPLETED']),
    )
    .orderBy('solvedProblems', 'desc')
    .orderBy('u.username', 'asc')
    .limit(page.limit)
    .offset(page.offset) as Array<{ username: string; solvedProblems: number | string }>;
  const totalRow = await db()('user_settings as settings')
    .join('users as u', 'u.id', 'settings.user_id')
    .where('settings.leaderboard_public', true)
    .countDistinct({ total: 'u.id' })
    .first() as { total: number | string } | undefined;
  const entries = rows.map((row, index) => ({
    rank: page.offset + index + 1,
    username: row.username,
    solvedProblems: Number(row.solvedProblems),
  }));
  res.json({ entries, total: Number(totalRow?.total ?? 0), limit: page.limit, offset: page.offset });
}));
