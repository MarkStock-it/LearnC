import { Router } from 'express';
import { z } from 'zod';
import * as repo from '../../db/repositories.js';
import { ApiError, asyncHandler, parseWith } from '../http.js';
import { idParamSchema, listProblemsQuerySchema } from '../schemas.js';
import { requireAuthenticatedUser } from '../middleware/currentUser.js';
import { problemHelperFileSchema } from '../../domain/sourceFiles.js';

export const problemsRouter = Router();

problemsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const query = parseWith(listProblemsQuerySchema, req.query, 'query parameters');
    const identity = req.sessionAuthenticated ? requireAuthenticatedUser(req) : null;
    const setAccess = query.problemSetId === undefined
      ? null
      : await repo.problemSetAccess(query.problemSetId, identity?.id ?? null);
    if (setAccess === 'forbidden' && identity) throw ApiError.forbidden('You do not have access to this problem set');
    if (setAccess === 'forbidden' || setAccess === 'not-found') throw ApiError.notFound('Problem set not found');

    const filters = {
      ...query,
      userId: identity?.id ?? null,
      isPublicSet: setAccess === 'public',
    };
    const [problems, total] = await Promise.all([
      repo.listProblems(filters),
      repo.countProblems(filters),
    ]);

    res.json({
      count: problems.length,
      total,
      limit: query.limit,
      offset: query.offset,
      problems: problems.map((problem) => ({
        id: problem.id,
        problemSetId: problem.problemSetId,
        title: problem.title,
        difficulty: problem.difficulty,
        tags: problem.tags,
        testCaseCount: problem.testCaseCount,
        publicTestCaseCount: problem.publicTestCaseCount,
        createdAt: problem.createdAt,
        solved: problem.solved,
      })),
    });
  }),
);

problemsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = parseWith(idParamSchema, req.params, 'path parameter');
    const userId = req.sessionAuthenticated ? requireAuthenticatedUser(req).id : null;
    const problem = await repo.findAccessibleProblem(id, userId);
    if (!problem) {
      const access = await repo.problemAccess(id, userId);
      if (access === 'forbidden' && userId !== null) throw ApiError.forbidden('You do not have access to this problem');
      throw ApiError.notFound('Problem not found');
    }

    const [publicTestCases, allTestCases, progress] = await Promise.all([
      repo.listTestCases(problem.id, { publicOnly: true }),
      repo.listTestCases(problem.id),
      userId === null
        ? Promise.resolve({ attempts: 0, solved: false, bestPassedCount: 0, lastSubmittedAt: null })
        : repo.getUserProblemProgress(userId, problem.id),
    ]);

    res.json({
      problem: {
        id: problem.id,
        problemSetId: problem.problemSetId,
        title: problem.title,
        description: problem.description,
        constraints: problem.constraints,
        sampleInput: problem.sampleInput,
        sampleOutput: problem.sampleOutput,
        difficulty: problem.difficulty,
        tags: problem.tags,
        aiGenerated: problem.aiGenerated,
        testCaseCount: allTestCases.length,
        publicTestCaseCount: publicTestCases.length,
        publicTestCases: publicTestCases.map((testCase) => ({
          id: testCase.id,
          inputData: testCase.inputData,
          expectedOutput: testCase.expectedOutput,
          description: testCase.description,
        })),
        helperFiles: (() => {
          const params = problem.aiPromptParams;
          const parsed = z.array(problemHelperFileSchema).safeParse(params?.helperFiles ?? []);
          return parsed.success ? parsed.data : [];
        })(),
      },
      progress,
    });
  }),
);
