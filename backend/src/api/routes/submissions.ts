import { Router } from 'express';
import { config } from '../../config.js';
import * as repo from '../../db/repositories.js';
import { compareOutput, describeErrorType } from '../../services/evaluationService.js';
import { enqueueSubmission } from '../../queue/index.js';
import { ApiError, asyncHandler, parseWith } from '../http.js';
import { createSubmissionSchema, idParamSchema, listSubmissionsQuerySchema } from '../schemas.js';
import { requireUser } from '../middleware/currentUser.js';

export const submissionsRouter = Router();

/**
 * Queue a submission (plan §1.2 step 4). Responds 202 with an id the client polls
 * at `GET /api/submissions/:id`.
 */
submissionsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = parseWith(createSubmissionSchema, req.body, 'request body');
    const user = requireUser(req);

    const problem = await repo.findProblem(body.problemId);
    if (!problem) throw ApiError.notFound(`Problem ${body.problemId} does not exist`);

    const testCases = await repo.listTestCases(problem.id);
    if (testCases.length === 0) {
      throw new ApiError(422, 'This problem has no test cases yet, so it cannot be graded.');
    }

    const submissionId = await repo.createSubmission({
      userId: user.id,
      problemId: problem.id,
      code: body.code,
    });

    await enqueueSubmission(submissionId);

    res.status(202).json({ submissionId, status: 'QUEUED', pollIntervalMs: 700 });
  }),
);

/**
 * Status + verdict. Hidden test cases report pass/fail, runtime and stderr but never
 * their input or expected output — otherwise the answers are one request away.
 */
submissionsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = parseWith(idParamSchema, req.params, 'path parameter');
    const user = requireUser(req);
    const submission = await repo.findSubmission(id);
    if (!submission) throw ApiError.notFound(`Submission ${id} does not exist`);

    // Submissions are private to their author. A mismatch (or a legacy row with no
    // owner) answers 404 rather than 403 so ids can't be probed for existence.
    if (submission.userId !== user.id) {
      throw ApiError.notFound(`Submission ${id} does not exist`);
    }

    const problem = await repo.findProblem(submission.problemId);
    const isFinished = submission.status === 'COMPLETED' || submission.status === 'FAILED';
    const storedResults = isFinished ? await repo.listSubmissionResults(submission.id) : [];

    const publicCases = await repo.listTestCases(submission.problemId, { publicOnly: true });
    const publicIds = new Set(publicCases.map((testCase) => testCase.id));

    const results = storedResults.map((result) => {
      const isPublic = result.testCaseId !== null && publicIds.has(result.testCaseId);
      const base = {
        testCaseId: result.testCaseId,
        // Name and description stay separate fields: the UI decides how to present them,
        // and nothing has to parse a composed string back apart.
        label: isPublic ? null : 'Hidden case',
        description: result.description,
        isPublic,
        passed: result.passed,
        errorType: result.errorType,
        message: describeErrorType(result.errorType),
        runtimeMs: result.runtimeMs,
        memoryUsedMb: result.memoryUsedMb,
        stderr: result.stderr && result.stderr.length > 0 ? result.stderr : null,
      };

      if (!isPublic || result.testCaseId === null) return base;

      const diff = result.passed
        ? []
        : compareOutput(result.expectedOutput ?? '', result.actualOutput ?? '').diff;

      return {
        ...base,
        inputData: result.inputData,
        expectedOutput: result.expectedOutput,
        actualOutput: result.actualOutput,
        diff,
      };
    });

    res.json({
      submission: {
        id: submission.id,
        problemId: submission.problemId,
        problemTitle: problem?.title ?? null,
        status: submission.status,
        compilationError: submission.compilationError,
        executor: submission.executor,
        errorMessage: submission.errorMessage,
        passedCount: submission.passedCount,
        totalCount: submission.totalCount,
        createdAt: submission.createdAt,
        completedAt: submission.completedAt,
        code: submission.code,
        // Plan §9.1: the executor is surfaced so students can see which sandbox graded them.
        sandbox: submission.executor,
        isFinished,
      },
      results,
      solved:
        isFinished &&
        submission.status === 'COMPLETED' &&
        submission.totalCount > 0 &&
        submission.passedCount === submission.totalCount,
      limits: {
        timeLimitSeconds: problem?.constraints.time_limit_seconds ?? null,
        memoryLimitMb: problem?.constraints.memory_limit_mb ?? config.executor.memoryLimitMb,
      },
    });
  }),
);

submissionsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const query = parseWith(listSubmissionsQuerySchema, req.query, 'query parameters');
    const user = requireUser(req);

    // History is always scoped to the requester. `mine` stays accepted (so old
    // bookmarks don't 400) but is ignored — `mine=false` used to expose every
    // student's submission ids and scores.
    const submissions = await repo.listSubmissions({
      userId: user.id,
      problemId: query.problemId,
      status: query.status,
      limit: query.limit ?? 25,
      offset: query.offset ?? 0,
    });

    res.json({
      count: submissions.length,
      submissions: submissions.map((submission) => ({
        id: submission.id,
        problemId: submission.problemId,
        problemTitle: submission.problemTitle,
        status: submission.status,
        passedCount: submission.passedCount,
        totalCount: submission.totalCount,
        executor: submission.executor,
        createdAt: submission.createdAt,
        completedAt: submission.completedAt,
      })),
    });
  }),
);
