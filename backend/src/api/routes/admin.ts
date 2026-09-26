import { Router } from 'express';
import { config } from '../../config.js';
import * as repo from '../../db/repositories.js';
import { generateProblemBundle, verifyTestCases } from '../../services/aiService.js';
import { logger } from '../../utils/logger.js';
import { ApiError, asyncHandler, parseWith } from '../http.js';
import { generateProblemSchema } from '../schemas.js';
import { requireUser } from '../middleware/currentUser.js';

export const adminRouter = Router();

/**
 * Admin guard. The plan defers real auth; a shared secret keeps generation
 * (which spends API credits and mutates content) out of public reach.
 */
adminRouter.use((req, _res, next) => {
  if (config.http.adminToken.length === 0) {
    next(ApiError.serviceUnavailable('Admin API is disabled: set ADMIN_TOKEN to enable it.'));
    return;
  }
  if (req.header('x-admin-token') !== config.http.adminToken) {
    next(ApiError.unauthorized('Invalid admin token'));
    return;
  }
  next();
});

/** POST /api/admin/generate-problem — plan §Phase 1, task 5. */
adminRouter.post(
  '/generate-problem',
  asyncHandler(async (req, res) => {
    const body = parseWith(generateProblemSchema, req.body, 'request body');

    const bundle = await generateProblemBundle({
      difficulty: body.difficulty,
      topics: body.topics,
      testCaseCount: body.testCaseCount,
      publicTestCaseCount: body.publicTestCaseCount,
      offset: Date.now() % 97,
    });

    const verification = await verifyTestCases(bundle.problem, bundle.testCases);

    if (!body.persist) {
      res.json({
        source: bundle.source,
        warnings: bundle.warnings,
        verification,
        problem: bundle.problem,
        testCases: bundle.testCases,
      });
      return;
    }

    let problemSetId = body.problemSetId ?? null;
    if (problemSetId === null) {
      const title = body.problemSetTitle ?? `Generated ${body.difficulty} set (${new Date().toISOString().slice(0, 10)})`;
      problemSetId = await repo.createProblemSet({
        title,
        description: 'Problem set generated through /api/admin/generate-problem.',
        examYear: body.examYear ?? null,
        examSemester: body.examSemester ?? null,
        difficulty: body.difficulty,
        createdBy: requireUser(req).id,
      });
    } else if (!(await repo.listProblemSets()).some((set) => set.id === problemSetId)) {
      throw ApiError.badRequest(`Problem set ${problemSetId} does not exist`);
    }

    const problemId = await repo.createProblem({
      problemSetId,
      title: bundle.problem.title,
      description: bundle.problem.description,
      constraints: bundle.problem.constraints,
      sampleInput: bundle.problem.constraints.sample_input,
      sampleOutput: bundle.problem.constraints.sample_output,
      difficulty: bundle.problem.difficulty,
      tags: bundle.problem.tags,
      aiGenerated: bundle.source === 'anthropic',
      aiPromptParams: {
        provider: bundle.source,
        difficulty: body.difficulty,
        topics: body.topics,
        generatedAt: new Date().toISOString(),
      },
    });

    const testCaseIds = await repo.insertTestCases(
      problemId,
      bundle.testCases.map((testCase) => ({
        input: testCase.input,
        expectedOutput: testCase.expected_output,
        isPublic: testCase.is_public,
        description: testCase.description || null,
      })),
    );

    logger.info(
      { problemId, problemSetId, source: bundle.source, testCases: testCaseIds.length, verified: verification.passed },
      'generated problem persisted',
    );

    res.status(201).json({
      source: bundle.source,
      warnings: bundle.warnings,
      verification,
      problemId,
      problemSetId,
      testCaseIds,
      problem: {
        title: bundle.problem.title,
        difficulty: bundle.problem.difficulty,
        tags: bundle.problem.tags,
        constraints: bundle.problem.constraints,
      },
    });
  }),
);
