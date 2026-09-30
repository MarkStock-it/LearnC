import { Router } from 'express';
import { z } from 'zod';
import * as repo from '../../db/repositories.js';
import { ApiError, asyncHandler, parseWith } from '../http.js';
import { idParamSchema } from '../schemas.js';

export const publicBundlesRouter = Router();

const browseSchema = z.object({
  search: z.string().trim().min(1).max(120).optional(),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
  tag: z.string().trim().min(1).max(40).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});

publicBundlesRouter.get('/', asyncHandler(async (req, res) => {
  const filters = parseWith(browseSchema, req.query, 'query parameters');
  const [result, total] = await Promise.all([
    repo.listPublicProblemSets(filters),
    repo.countPublicProblemSets(filters),
  ]);
  res.json({ count: result.length, total, limit: filters.limit, offset: filters.offset, problemSets: result });
}));

const problemsPageSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});

publicBundlesRouter.get('/:id', asyncHandler(async (req, res) => {
  const { id } = parseWith(idParamSchema, req.params, 'path parameter');
  const page = parseWith(problemsPageSchema, req.query, 'query parameters');
  const access = await repo.problemSetAccess(id, null);
  if (access !== 'public') throw ApiError.notFound('Public bundle not found');
  const bundle = await repo.findPublicProblemSet(id);
  if (!bundle) throw ApiError.notFound('Public bundle not found');
  const [problems, totalProblems] = await Promise.all([
    repo.listPublicProblemsInSet(id, page),
    repo.countPublicProblemsInSet(id),
  ]);
  res.json({
    problemSet: bundle,
    totalProblems,
    limit: page.limit,
    offset: page.offset,
    problems: problems.map((problem) => ({
      id: problem.id,
      title: problem.title,
      difficulty: problem.difficulty,
      tags: problem.tags,
      description: problem.description,
    })),
  });
}));
