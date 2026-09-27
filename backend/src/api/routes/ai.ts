import { Router } from 'express';
import * as authRepo from '../../db/authRepositories.js';
import * as repo from '../../db/repositories.js';
import { generateProblemBundleForUser, verifyTestCases } from '../../services/aiService.js';
import { logger } from '../../utils/logger.js';
import { ApiError, asyncHandler, parseWith } from '../http.js';
import { requireUser } from '../middleware/currentUser.js';
import { generateProblemSchema } from '../schemas.js';

export const aiRouter = Router();

/** Every route here needs a resolved user. */
aiRouter.use((req, _res, next) => {
  requireUser(req);
  next();
});

/**
 * POST /api/ai/generate-problem — the student-facing counterpart of the admin
 * endpoint. Provider chain: the user's Gemini key when chosen, then the server's
 * configured provider, then the curated bank. The generated expectations are
 * verified in the sandbox before anything is stored.
 */
aiRouter.post(
  '/generate-problem',
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const body = parseWith(generateProblemSchema, req.body, 'request body');

    const settings = await authRepo.getSettings(user.id);
    const geminiKey = await authRepo.getGeminiKey(user.id);
    const { bundle, providerUsed, geminiError } = await generateProblemBundleForUser(
      {
        difficulty: body.difficulty,
        topics: body.topics,
        testCaseCount: body.testCaseCount,
        publicTestCaseCount: body.publicTestCaseCount,
        offset: Date.now() % 97,
      },
      { aiProvider: settings.aiProvider, geminiKey },
    );

    const verification = await verifyTestCases(bundle.problem, bundle.testCases);

    if (!body.persist) {
      res.json({
        source: bundle.source,
        providerUsed,
        geminiError,
        warnings: bundle.warnings,
        verification,
        problem: bundle.problem,
        testCases: bundle.testCases,
      });
      return;
    }

    // Generated problems land in a per-user set so students own their content.
    const setTitle = body.problemSetTitle ?? `${user.username}'s AI problems`;
    const sets = await repo.listProblemSets();
    let problemSetId = sets.find((set) => set.title === setTitle && set.examYear === null)?.id ?? null;
    if (problemSetId === null) {
      problemSetId = await repo.createProblemSet({
        title: setTitle,
        description: `AI-generated problems created by ${user.username}.`,
        difficulty: body.difficulty,
        createdBy: user.id,
      });
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
      aiGenerated: bundle.source !== 'offline',
      aiPromptParams: {
        provider: bundle.source,
        providerUsed,
        difficulty: body.difficulty,
        topics: body.topics,
        generatedFor: user.username,
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
      { userId: user.id, problemId, problemSetId, source: bundle.source, providerUsed, verified: verification.passed },
      'user-generated problem persisted',
    );

    res.status(201).json({
      source: bundle.source,
      providerUsed,
      geminiError,
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

/** GET /api/ai/status — what the server-side provider is right now. */
aiRouter.get('/status', (_req, res) => {
  res.json({
    serverProvider: process.env['AI_PROVIDER'] ?? 'offline',
    model: process.env['AI_MODEL'] ?? null,
  });
});

export function requireAiEnabled(): void {
  // Placeholder for a future global kill switch; generation is per-user gated.
  if (!aiRouter) throw ApiError.serviceUnavailable('AI generation is disabled');
}
