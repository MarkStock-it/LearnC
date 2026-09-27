import { Router } from 'express';
import * as authRepo from '../../db/authRepositories.js';
import * as repo from '../../db/repositories.js';
import { generateProblemBundleForUser, verifyTestCases, type GeneratedBundle } from '../../services/aiService.js';
import { logger } from '../../utils/logger.js';
import { asyncHandler, parseWith } from '../http.js';
import { requireUser } from '../middleware/currentUser.js';
import { generateProblemSchema } from '../schemas.js';

export const aiRouter = Router();

/** Every route here needs a resolved user. */
aiRouter.use((req, _res, next) => {
  requireUser(req);
  next();
});

interface PersistedProblem {
  problemId: number;
  title: string;
  difficulty: string;
  verificationPassed: boolean;
  verificationDetail: string;
  warnings: string[];
}

async function generateOne(
  userId: number,
  username: string,
  body: ReturnType<typeof generateProblemSchema.parse>,
  geminiKey: string | null,
  avoidTitles: string[],
): Promise<PersistedProblem> {
  const { bundle, providerUsed, geminiError } = await generateProblemBundleForUser(
    {
      difficulty: body.difficulty,
      topics: body.topics,
      testCaseCount: body.testCaseCount,
      publicTestCaseCount: body.publicTestCaseCount,
      offset: Date.now() % 97,
      // Learner intent + avoid-list ride along so the provider can honour them.
      instructions: body.quiz.instructions,
      avoidTitles,
    },
    {
      aiProvider: body.compact ? 'gemini' : (await authRepo.getSettings(userId)).aiProvider,
      geminiKey,
      geminiModel: body.geminiModel,
      compact: body.compact,
    },
  );

  const verification = await verifyTestCases(bundle.problem, bundle.testCases);

  if (!body.persist) {
    throw new Error('dry-run-not-supported-in-quiz-loop');
  }

  const setTitle = body.quiz.quizTitle ?? `${username}'s practice quiz`;
  const sets = await repo.listProblemSets();
  let problemSetId = sets.find((set) => set.title === setTitle && set.examYear === null)?.id ?? null;
  if (problemSetId === null) {
    problemSetId = await repo.createProblemSet({
      title: setTitle,
      description: `AI-generated practice problems created by ${username}.`,
      difficulty: body.difficulty,
      createdBy: userId,
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
  };
}

/**
 * POST /api/ai/generate-problem — the student-facing generator with quiz
 * customisation. Provider chain per problem: the user's Gemini key (compact
 * one-call mode by default to spare their quota), then the server provider,
 * then the curated bank. Every generated bundle is verified in the sandbox
 * before it is stored.
 */
aiRouter.post(
  '/generate-problem',
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const body = parseWith(generateProblemSchema, req.body, 'request body');
    const geminiKey = await authRepo.getGeminiKey(user.id);

    const count = body.quiz.problemCount;
    const created: PersistedProblem[] = [];
    const avoid: string[] = [...body.quiz.avoidTitles];
    const providerUsedList = new Set<string>();
    let geminiError: string | null = null;

    for (let index = 0; index < count; index += 1) {
      try {
        const item = await generateOne(user.id, user.username, body, geminiKey, avoid);
        created.push(item);
        avoid.push(item.title);
        if (item.warnings.some((warning) => warning.startsWith('Gemini generation failed'))) {
          geminiError = item.warnings.find((warning) => warning.startsWith('Gemini generation failed')) ?? null;
        }
      } catch (error) {
        if (error instanceof Error && error.message === 'dry-run-not-supported-in-quiz-loop') break;
        throw error;
      }
    }

    res.status(201).json({
      count: created.length,
      problems: created,
      problemSetId: created.length > 0 ? (await repo.listProblemSets()).find((set) => set.title === (body.quiz.quizTitle ?? `${user.username}'s practice quiz`))?.id ?? null : null,
      geminiError,
      notes:
        created.length < count
          ? [`Only ${created.length}/${count} problems could be generated; check warnings.`]
          : [],
    });
  }),
);

/** GET /api/ai/status — what the server-side provider is right now. */
aiRouter.get('/status', asyncHandler(async (_req, res) => {
  const settings = (await import('../../config.js')).config.ai;
  res.json({
    serverProvider: settings.provider,
    model: settings.model,
    compactDefault: true,
  });
}));

/** Keep the bundle type import honest for future dry-run support. */
export type { GeneratedBundle };
