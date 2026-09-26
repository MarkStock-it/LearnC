import { Router } from 'express';
import * as repo from '../../db/repositories.js';
import { ApiError, asyncHandler, parseWith } from '../http.js';
import { idParamSchema, listProblemsQuerySchema } from '../schemas.js';
import { requireUser } from '../middleware/currentUser.js';

export const problemsRouter = Router();

problemsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const query = parseWith(listProblemsQuerySchema, req.query, 'query parameters');
    const problems = await repo.listProblems(query);

    res.json({
      count: problems.length,
      problems: problems.map((problem) => ({
        id: problem.id,
        problemSetId: problem.problemSetId,
        title: problem.title,
        difficulty: problem.difficulty,
        tags: problem.tags,
        testCaseCount: problem.testCaseCount,
        publicTestCaseCount: problem.publicTestCaseCount,
        createdAt: problem.createdAt,
      })),
    });
  }),
);

problemsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = parseWith(idParamSchema, req.params, 'path parameter');
    const problem = await repo.findProblem(id);
    if (!problem) throw ApiError.notFound(`Problem ${id} does not exist`);

    const [publicTestCases, allTestCases, progress] = await Promise.all([
      repo.listTestCases(problem.id, { publicOnly: true }),
      repo.listTestCases(problem.id),
      repo.getUserProblemProgress(requireUser(req).id, problem.id),
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
        // Only public samples are ever exposed here; hidden expectations stay server-side.
        publicTestCases: publicTestCases.map((testCase) => ({
          id: testCase.id,
          inputData: testCase.inputData,
          expectedOutput: testCase.expectedOutput,
          description: testCase.description,
        })),
      },
      progress,
    });
  }),
);
