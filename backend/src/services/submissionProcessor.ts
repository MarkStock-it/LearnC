import { config } from '../config.js';
import { sqlTimestamp } from '../db/dialect.js';
import * as repo from '../db/repositories.js';
import type { ExecutionLimits } from '../domain/types.js';
import { logger } from '../utils/logger.js';
import { getExecutor } from './executor/index.js';

/** Derive the sandbox envelope from the problem's own constraints, clamped by config. */
function resolveLimits(constraints: { time_limit_seconds?: number; memory_limit_mb?: number }): ExecutionLimits {
  const timeLimitMs = Math.min(
    Math.max((constraints.time_limit_seconds ?? 5) * 1000, 250),
    config.executor.timeLimitMs,
  );
  return {
    timeLimitMs,
    memoryLimitMb: Math.min(constraints.memory_limit_mb ?? config.executor.memoryLimitMb, 1024),
    pidsLimit: config.executor.pidsLimit,
    maxOutputBytes: config.executor.maxOutputBytes,
  };
}

/**
 * The unit of work behind `POST /api/submissions` (plan §1.2 steps 6-9).
 *
 * Status contract chosen here (the plan is ambiguous between FAILED-means-bad-code
 * and FAILED-means-infrastructure):
 *   - a compile error or failed verdict ends as COMPLETED, with `compilation_error`
 *     or per-case results describing why. Re-running would not change the answer.
 *   - FAILED is reserved for infrastructure problems, and is set by the queue after
 *     retries are exhausted.
 * Throwing therefore signals "retry me", never "the student was wrong".
 */
export async function processSubmission(submissionId: number): Promise<void> {
  const startedAt = Date.now();
  const submission = await repo.findSubmission(submissionId);
  if (!submission) throw new Error(`Submission ${submissionId} does not exist`);

  const problem = await repo.findProblem(submission.problemId);
  if (!problem) throw new Error(`Problem ${submission.problemId} does not exist`);

  const testCases = await repo.listTestCases(problem.id);
  if (testCases.length === 0) {
    await repo.updateSubmission(submissionId, {
      status: 'COMPLETED',
      totalCount: 0,
      passedCount: 0,
      completedAt: sqlTimestamp(),
      errorMessage: 'This problem has no test cases yet.',
    });
    logger.warn({ submissionId, problemId: problem.id }, 'problem has no test cases');
    return;
  }

  await repo.updateSubmission(submissionId, { status: 'COMPILING', errorMessage: null });

  const { executor, kind } = await getExecutor();
  await repo.updateSubmission(submissionId, { status: 'EXECUTING', executor: kind });

  const outcome = await executor.execute({
    code: submission.code,
    testCases: testCases.map((testCase) => ({
      id: testCase.id,
      inputData: testCase.inputData,
      expectedOutput: testCase.expectedOutput,
    })),
    limits: resolveLimits(problem.constraints),
  });

  if (!outcome.compiled) {
    await repo.updateSubmission(submissionId, {
      status: 'COMPLETED',
      compilationError: outcome.compilationError,
      executor: outcome.executor,
      passedCount: 0,
      totalCount: testCases.length,
      completedAt: sqlTimestamp(),
    });
    logger.info(
      { submissionId, problemId: problem.id, executor: outcome.executor, durationMs: Date.now() - startedAt },
      'submission completed with compilation error',
    );
    return;
  }

  await repo.replaceSubmissionResults(
    submissionId,
    outcome.runs.map((run) => ({
      testCaseId: run.testCaseId,
      passed: run.passed,
      actualOutput: run.actualOutput,
      stderr: run.stderr,
      runtimeMs: run.runtimeMs,
      memoryUsedMb: run.memoryUsedMb,
      errorType: run.errorType,
    })),
  );

  const passedCount = outcome.runs.filter((run) => run.passed).length;
  await repo.updateSubmission(submissionId, {
    status: 'COMPLETED',
    compilationError: null,
    executor: outcome.executor,
    passedCount,
    totalCount: testCases.length,
    completedAt: sqlTimestamp(),
  });

  logger.info(
    {
      submissionId,
      problemId: problem.id,
      executor: outcome.executor,
      passedCount,
      totalCount: testCases.length,
      durationMs: Date.now() - startedAt,
    },
    'submission processed',
  );
}
