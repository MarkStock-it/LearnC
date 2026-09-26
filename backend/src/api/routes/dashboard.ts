import { Router } from 'express';
import * as repo from '../../db/repositories.js';
import { asyncHandler } from '../http.js';
import { requireUser } from '../middleware/currentUser.js';

export const dashboardRouter = Router();

dashboardRouter.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
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
