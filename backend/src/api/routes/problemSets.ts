import { Router } from 'express';
import * as repo from '../../db/repositories.js';
import { ApiError, asyncHandler, parseWith } from '../http.js';
import { requireAuthenticatedUser, requireUser } from '../middleware/currentUser.js';
import { resolveUser } from '../middleware/tokenAuth.js';
import { z } from 'zod';

const listQuery = z.object({
  search: z.string().trim().min(1).max(120).optional(),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
  tag: z.string().trim().min(1).max(40).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});
const setIdSchema = z.object({ id: z.coerce.number().int().positive() });
const publishSchema = z.object({ isPublic: z.boolean() });
const deleteQuery = z.object({ confirm: z.literal('true') });
const forkSchema = z.object({ title: z.string().trim().min(1).max(255).optional() });

export const problemSetsRouter = Router();
problemSetsRouter.use(resolveUser());

problemSetsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const query = parseWith(listQuery, req.query, 'query parameters');
    const userId = req.sessionAuthenticated ? requireUser(req).id : null;
    const [problemSets, total] = await Promise.all([
      repo.listProblemSets(userId, query),
      repo.countProblemSets(userId, query),
    ]);
    res.json({ count: problemSets.length, total, limit: query.limit, offset: query.offset, problemSets });
  }),
);

problemSetsRouter.get(
  '/public',
  asyncHandler(async (req, res) => {
    const query = parseWith(listQuery, req.query, 'query parameters');
    const [problemSets, total] = await Promise.all([
      repo.listPublicProblemSets(query),
      repo.countPublicProblemSets(query),
    ]);
    res.json({ count: problemSets.length, total, limit: query.limit, offset: query.offset, problemSets });
  }),
);

problemSetsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = parseWith(setIdSchema, req.params, 'path parameter');
    const userId = req.sessionAuthenticated ? requireUser(req).id : null;
    const access = await repo.problemSetAccess(id, userId);
    if (access === 'not-found' || access === 'forbidden') throw ApiError.notFound('Problem set not found');
    const problemSet = access === 'public'
      ? await repo.findPublicProblemSet(id)
      : await repo.findProblemSet(id);
    if (!problemSet) throw ApiError.notFound('Problem set not found');
    res.json({ problemSet });
  }),
);

problemSetsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    if (!req.sessionAuthenticated) throw ApiError.unauthorized('A valid signed-in session is required');
    const user = requireAuthenticatedUser(req);
    const { id } = parseWith(setIdSchema, req.params, 'path parameter');
    parseWith(deleteQuery, req.query, 'query parameters');
    const result = await repo.deleteOwnedProblemSet(id, user.id);
    if (result === 'not-found') throw ApiError.notFound('Problem set not found');
    if (result === 'forbidden') throw ApiError.forbidden('You do not own this problem set');
    res.status(204).end();
  }),
);

problemSetsRouter.post(
  '/:id/publish',
  asyncHandler(async (req, res) => {
    if (!req.sessionAuthenticated) throw ApiError.unauthorized('A valid signed-in session is required');
    const user = requireAuthenticatedUser(req);
    const { id } = parseWith(setIdSchema, req.params, 'path parameter');
    const { isPublic } = parseWith(publishSchema, req.body, 'request body');
    const result = await repo.setProblemSetPublic(id, user.id, isPublic);
    if (result === 'not-found') throw ApiError.notFound('Problem set not found');
    if (result === 'forbidden') throw ApiError.forbidden('You do not own this problem set');
    res.json({ problemSet: await repo.findProblemSet(id) });
  }),
);

problemSetsRouter.post(
  '/:id/fork',
  asyncHandler(async (req, res) => {
    if (!req.sessionAuthenticated) throw ApiError.unauthorized('A valid signed-in session is required');
    const user = requireAuthenticatedUser(req);
    const { id } = parseWith(setIdSchema, req.params, 'path parameter');
    const body = parseWith(forkSchema, req.body ?? {}, 'request body');
    const access = await repo.problemSetAccess(id, user.id);
    if (access === 'not-found') throw ApiError.notFound('Problem set not found');
    if (access !== 'public') throw ApiError.forbidden('Only public bundles can be forked');
    const source = await repo.findPublicProblemSet(id);
    if (!source) throw ApiError.notFound('Problem set not found');
    const problems = await repo.listPublicProblemsInSet(id);
    const newSetId = await repo.createProblemSet({
      title: body.title ?? `${source.title} (copy)`,
      description: source.description,
      difficulty: source.difficulty,
      userId: user.id,
    });
    for (const problem of problems) {
      const newProblemId = await repo.createProblem({
        problemSetId: newSetId,
        title: problem.title,
        description: problem.description,
        constraints: problem.constraints,
        sampleInput: problem.sampleInput ?? '',
        sampleOutput: problem.sampleOutput ?? '',
        difficulty: problem.difficulty,
        tags: problem.tags,
        aiGenerated: problem.aiGenerated,
        aiPromptParams: problem.aiPromptParams,
      });
      const cases = await repo.listTestCases(problem.id);
      await repo.insertTestCases(newProblemId, cases.map((testCase) => ({
        input: testCase.inputData,
        expectedOutput: testCase.expectedOutput,
        isPublic: testCase.isPublic,
        description: testCase.description,
        weight: testCase.weight,
      })));
    }
    res.status(201).json({ problemSetId: newSetId });
  }),
);
