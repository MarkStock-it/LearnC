import { Router } from 'express';
import * as authRepo from '../../db/authRepositories.js';
import * as repo from '../../db/repositories.js';
import { generateProblemBundleForUser, verifyTestCases, type GeneratedBundle } from '../../services/aiService.js';
import { logger } from '../../utils/logger.js';
import { asyncHandler, parseWith } from '../http.js';
import { requireAuthenticatedUser } from '../middleware/currentUser.js';
import { generateProblemSchema } from '../schemas.js';

export const aiRouter = Router();

aiRouter.use('/generate-problem', (req, _res, next) => {
  try {
    requireAuthenticatedUser(req);
    next();
  } catch (error) {
    next(error);
  }
});

interface PersistedProblem {
  problemId: number;
  title: string;
  difficulty: string;
  verificationPassed: boolean;
  verificationDetail: string;
  warnings: string[];
  providerUsed: 'gemini' | 'server' | 'offline';
  helperFiles: Array<{ filename: string; language: 'c' | 'h'; purpose: string; autoInclude: boolean; content: string }>;
}

async function generateOne(
  userId: number,
  username: string,
  body: ReturnType<typeof generateProblemSchema.parse>,
  geminiKey: string | null,
  avoidTitles: string[],
): Promise<PersistedProblem> {
  const { bundle, providerUsed } = await generateProblemBundleForUser(
    {
      difficulty: body.difficulty,
      topics: body.topics,
      testCaseCount: body.testCaseCount,
      publicTestCaseCount: body.publicTestCaseCount,
      offset: Date.now() % 97,
      // Learner intent + avoid-list ride along so the provider can honour them.
      instructions: body.quiz.instructions,
      avoidTitles,
      excludeProblemIds: body.excludeProblemIds,
    },
    {
      aiProvider: (await authRepo.getSettings(userId)).aiProvider,
      geminiKey,
      geminiModel: body.geminiModel,
      compact: body.compact,
    },
  );

  const verification = await verifyTestCases(bundle.problem, bundle.testCases, bundle.helperFiles);

  if (!body.persist) {
    throw new Error('dry-run-not-supported-in-quiz-loop');
  }

  const setTitle = body.quiz.quizTitle ?? `${username}'s practice quiz`;
  const sets = await repo.listProblemSets(userId);
  let problemSetId = sets.find((set) => set.title === setTitle && set.examYear === null)?.id ?? null;
  if (problemSetId === null) {
    problemSetId = await repo.createProblemSet({
      title: setTitle,
      description: `AI-generated practice problems created by ${username}.`,
      difficulty: body.difficulty,
      userId,
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
      helperFiles: bundle.helperFiles,
      providerUsed,
      difficulty: body.difficulty,
      topics: body.topics,
      instructions: body.quiz.instructions ?? null,
      generatedFor: username,
      generatedAt: new Date().toISOString(),
    },
  });

  await repo.insertTestCases(
    problemId,
    bundle.testCases.map((testCase) => ({
      input: testCase.input,
      expectedOutput: testCase.expected_output,
      isPublic: testCase.is_public,
      description: testCase.description || null,
    })),
  );

  logger.info(
    { userId, problemId, problemSetId, source: bundle.source, providerUsed, verified: verification.passed },
    'user-generated problem persisted',
  );

  return {
    problemId,
    title: bundle.problem.title,
    difficulty: bundle.problem.difficulty,
    verificationPassed: verification.passed,
    verificationDetail: verification.detail,
    warnings: bundle.warnings,
    providerUsed,
    helperFiles: bundle.helperFiles,
  };

}

/**
 * POST /api/ai/generate-problem — the student-facing generator with quiz
 * customisation. Provider chain per problem: the user's Gemini key (compact
 * one-call mode by default to spare their quota, paced against a per-key
 * token budget), then the server provider, then the curated bank. Every
 * generated bundle is verified in the sandbox before it is stored. A failing
 * item no longer aborts the quiz: whatever was made is kept, and each
 * failure is reported in `notes`.
 */
aiRouter.post(
  '/generate-problem',
  asyncHandler(async (req, res) => {
    const user = requireAuthenticatedUser(req);
    const body = parseWith(generateProblemSchema, req.body, 'request body');
    const geminiKey = await authRepo.getGeminiKey(user.id);

    const count = body.quiz.problemCount;
    const created: PersistedProblem[] = [];
    const failures: string[] = [];
    // The avoid-list rides in every prompt, so it stays bounded: the quiz
    // list plus the twelve most recent sets, and only the freshest slice of
    // the running list per call (the prompt formatter caps it again).
    const avoid: string[] = [
      ...body.quiz.avoidTitles.slice(-8),
      ...(await repo.listProblemSets(user.id)).slice(0, 12).map((set) => set.title),
    ];

    for (let index = 0; index < count; index += 1) {
      try {
        const item = await generateOne(user.id, user.username, body, geminiKey, avoid.slice(-16));
        created.push(item);
        avoid.push(item.title);
      } catch (error) {
        if (error instanceof Error && error.message === 'dry-run-not-supported-in-quiz-loop') break;
        // One bad item no longer aborts the quiz: keep what was made and say
        // exactly which item failed, so the student gets problems, not a 500.
        const message = error instanceof Error ? error.message : String(error);
        logger.warn({ userId: user.id, index, err: message }, 'quiz item failed — keeping the problems already made');
        failures.push(`Problem ${index + 1} of ${count} could not be generated: ${message.slice(0, 200)}`);
      }
    }

    res.status(201).json({
      count: created.length,
      problems: created,
      geminiError: created.flatMap((item) => item.warnings).find((warning) => warning.startsWith('Gemini generation failed')) ?? null,
      problemSetId: created.length > 0 ? (await repo.listProblemSets(user.id)).find((set) => set.title === (body.quiz.quizTitle ?? `${user.username}'s practice quiz`))?.id ?? null : null,
      notes:
        created.length < count
          ? [`Only ${created.length}/${count} problems could be generated; check warnings.`, ...failures]
          : [],
    });
  }),
);

/** GET /api/ai/status — what the server-side provider is right now. */
aiRouter.get('/status', asyncHandler(async (req, res) => {
  requireAuthenticatedUser(req);
  const settings = (await import('../../config.js')).config.ai;
  res.json({
    serverProvider: settings.provider,
    model: settings.model,
    compactDefault: true,
  });
}));

/** Keep the bundle type import honest for future dry-run support. */
export type { GeneratedBundle };
