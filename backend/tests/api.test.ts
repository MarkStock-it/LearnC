import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { closeDb } from '../src/db/knex.js';
import * as repo from '../src/db/repositories.js';
import { getQueue, startQueue, stopQueue } from '../src/queue/index.js';
import { findBankProblem } from '../src/services/problemBank.js';
import { prepareDatabase, resetDatabase, seedFixture, type Fixture } from './helpers.js';

const bank = findBankProblem('array-sum')!;

/** A correct solution: the bank's own reference implementation. */
const CORRECT = bank.referenceSolution;

/** Correct arithmetic, but always off by one — must fail every case. */
const OFF_BY_ONE = `#include <stdio.h>
int main(void) {
    int n, x;
    long long sum = 0;
    if (scanf("%d", &n) != 1) return 1;
    for (int i = 0; i < n; i++) { if (scanf("%d", &x) != 1) return 1; sum += x; }
    printf("%lld\\n", sum + 1);
    return 0;
}
`;

const INFINITE_LOOP = '#include <stdio.h>\nint main(void){ while (1) { } return 0; }\n';
const WILL_NOT_COMPILE = 'int main(void) { return oops_not_declared; }\n';

let app: Express;
let fixture: Fixture;

async function submitAndWait(code: string, expectedStatus = 202): Promise<Record<string, unknown>> {
  const created = await request(app)
    .post('/api/submissions')
    .send({ problemId: fixture.problemId, code })
    .expect(expectedStatus);

  const submissionId = created.body.submissionId as number;
  // Deterministic wait instead of a sleep loop: the inline queue exposes awaitIdle.
  await getQueue().awaitIdle?.(90_000);

  const detail = await request(app).get(`/api/submissions/${submissionId}`).expect(200);
  return detail.body as Record<string, unknown>;
}

beforeAll(async () => {
  await prepareDatabase();
  await startQueue();
  app = createApp();
});

beforeEach(async () => {
  await resetDatabase();
  fixture = await seedFixture('array-sum');
});

afterAll(async () => {
  await stopQueue();
  await closeDb();
});

describe('GET /api/health', () => {
  it('reports the sandbox and queue backing this instance', async () => {
    const response = await request(app).get('/api/health').expect(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.database.status).toBe('ok');
    expect(response.body.queue.driver).toBe('inline');
    expect(response.body.sandbox.available).toBe(true);
    expect(['local', 'docker']).toContain(response.body.sandbox.kind);
  });
});

describe('problem discovery', () => {
  it('lists exam bundles with their problem counts', async () => {
    const response = await request(app).get('/api/problem-sets').expect(200);
    expect(response.body.count).toBe(1);
    expect(response.body.problemSets[0]).toMatchObject({ examYear: 2024, examSemester: 'test', problemCount: 1 });
  });

  it('lists problems with tag, difficulty and search filters', async () => {
    const all = await request(app).get('/api/problems').expect(200);
    expect(all.body.count).toBe(1);

    const matching = await request(app).get('/api/problems?tag=arrays&difficulty=easy').expect(200);
    expect(matching.body.count).toBe(1);

    const notMatching = await request(app).get('/api/problems?tag=matrices').expect(200);
    expect(notMatching.body.count).toBe(0);

    const searched = await request(app).get('/api/problems?search=Array').expect(200);
    expect(searched.body.count).toBe(1);
  });

  it('exposes public samples but never hidden test cases', async () => {
    const response = await request(app).get(`/api/problems/${fixture.problemId}`).expect(200);
    const { problem } = response.body;

    expect(problem.publicTestCases).toHaveLength(3);
    expect(problem.testCaseCount).toBe(7);
    expect(problem.publicTestCaseCount).toBe(3);
    expect(problem.constraints.time_limit_seconds).toBe(2);

    // The hidden cases must not be reachable anywhere in this payload. Asserting on
    // whole outputs is too weak ("0" appears all over a JSON payload), so check the
    // distinctive descriptions and input fragments instead.
    const serialised = JSON.stringify(response.body);
    for (const testCase of bank.testCases.filter((entry) => !entry.isPublic)) {
      expect(serialised).not.toContain(testCase.description);
    }
    for (const hiddenInput of ['2\n-5 5', '1000000 2000000', '6\n0 0 0 0 0 1', '9 8 7 6 5 4 3 2']) {
      expect(serialised).not.toContain(hiddenInput);
    }
  });

  it('rejects an unknown problem id', async () => {
    await request(app).get('/api/problems/999999').expect(404);
  });
});

describe('POST /api/submissions', () => {
  it('runs a correct solution to completion and marks the problem solved', async () => {
    const body = await submitAndWait(CORRECT);
    const submission = body.submission as Record<string, unknown>;

    expect(submission.status).toBe('COMPLETED');
    expect(submission.passedCount).toBe(7);
    expect(submission.totalCount).toBe(7);
    expect(submission.compilationError).toBeNull();
    expect(body.solved).toBe(true);

    const results = body.results as Array<Record<string, unknown>>;
    expect(results).toHaveLength(7);
    expect(results.every((result) => result.passed === true)).toBe(true);
    expect(results.every((result) => result.errorType === 'PASS')).toBe(true);

    const publicResults = results.filter((result) => result.isPublic === true);
    expect(publicResults).toHaveLength(3);
    expect(publicResults[0]).toHaveProperty('expectedOutput');
    expect(publicResults[0]).toHaveProperty('inputData');

    // Hidden cases report the verdict without leaking the expectation.
    const hiddenResults = results.filter((result) => result.isPublic === false);
    expect(hiddenResults).toHaveLength(4);
    expect(hiddenResults[0]).not.toHaveProperty('expectedOutput');
    expect(hiddenResults[0]).not.toHaveProperty('diff');
  });

  it('reports a diff for public cases and hides expectations for hidden ones', async () => {
    const body = await submitAndWait(OFF_BY_ONE);
    const submission = body.submission as Record<string, unknown>;

    expect(submission.status).toBe('COMPLETED');
    expect(submission.passedCount).toBe(0);
    expect(body.solved).toBe(false);

    const results = body.results as Array<Record<string, unknown>>;
    const publicCase = results.find((result) => result.isPublic === true) as Record<string, unknown>;
    expect(publicCase.errorType).toBe('WRONG_ANSWER');
    expect(publicCase.actualOutput).toContain('7');
    expect(publicCase.expectedOutput).toContain('6');
    expect(publicCase.diff).toEqual([{ line: 1, expected: '6', actual: '7' }]);
    expect(publicCase.message).toMatch(/does not match/i);

    const hiddenCase = results.find((result) => result.isPublic === false) as Record<string, unknown>;
    expect(hiddenCase.passed).toBe(false);
    expect(hiddenCase).not.toHaveProperty('expectedOutput');
    expect(hiddenCase.label).toMatch(/Hidden case/);
  });

  it('turns a compile error into a readable verdict instead of a queue failure', async () => {
    const body = await submitAndWait(WILL_NOT_COMPILE);
    const submission = body.submission as Record<string, unknown>;

    expect(submission.status).toBe('COMPLETED');
    expect(submission.compilationError).toContain('oops_not_declared');
    expect(submission.passedCount).toBe(0);
    expect(body.results).toEqual([]);
    expect(body.solved).toBe(false);
  });

  it('times out an infinite loop instead of hanging the API', async () => {
    const body = await submitAndWait(INFINITE_LOOP);
    const submission = body.submission as Record<string, unknown>;

    expect(submission.status).toBe('COMPLETED');
    const results = body.results as Array<Record<string, unknown>>;
    expect(results).toHaveLength(7);
    expect(results.every((result) => result.errorType === 'TIMEOUT')).toBe(true);
    expect(results.every((result) => result.passed === false)).toBe(true);
    // The verdict is reached even though every case burns the full time limit.
    expect(submission.completedAt).toBeTruthy();
  });

  it('validates the payload', async () => {
    await request(app).post('/api/submissions').send({ problemId: fixture.problemId, code: '' }).expect(400);
    await request(app)
      .post('/api/submissions')
      .send({ problemId: 'not-a-number', code: 'int main(void){return 0;}' })
      .expect(400);
    await request(app)
      .post('/api/submissions')
      .send({ problemId: 999999, code: 'int main(void){return 0;}' })
      .expect(404);
  });

  it('refuses to grade a problem with no test cases', async () => {
    const user = await repo.ensureUser('empty-instructor');
    const setId = await repo.createProblemSet({ title: 'Empty set', createdBy: user.id });
    const problemId = await repo.createProblem({
      problemSetId: setId,
      title: 'No tests yet',
      description: 'A problem with no test cases.',
      constraints: {
        time_limit_seconds: 2,
        memory_limit_mb: 256,
        input_format: '',
        output_format: '',
        sample_input: '',
        sample_output: '',
      },
      sampleInput: '',
      sampleOutput: '',
      difficulty: 'easy',
      tags: ['misc'],
      aiGenerated: false,
    });

    const response = await request(app)
      .post('/api/submissions')
      .send({ problemId, code: 'int main(void){return 0;}' })
      .expect(422);
    expect(response.body.error.message).toMatch(/no test cases/i);
  });
});

describe('history and progress', () => {
  it('keeps each user’s history separate', async () => {
    await submitAndWait(CORRECT);

    const guestHistory = await request(app).get('/api/submissions?mine=true').expect(200);
    expect(guestHistory.body.count).toBe(1);
    expect(guestHistory.body.submissions[0].problemTitle).toBe(bank.title);

    const other = await repo.ensureUser('other-student');
    const otherHistory = await request(app)
      .get('/api/submissions?mine=true')
      .set('x-user-id', String(other.id))
      .expect(200);
    expect(otherHistory.body.count).toBe(0);
  });

  it('reports dashboard progress for the requesting user', async () => {
    await submitAndWait(CORRECT);

    const response = await request(app).get('/api/dashboard/stats').expect(200);
    expect(response.body.stats.totalSubmissions).toBe(1);
    expect(response.body.stats.solvedProblems).toBe(1);
    expect(response.body.stats.solvedProblemIds).toContain(fixture.problemId);
    expect(response.body.recentSubmissions[0].problemTitle).toBe(bank.title);
  });

  it('records per-problem progress on the problem page', async () => {
    await submitAndWait(OFF_BY_ONE);
    const response = await request(app).get(`/api/problems/${fixture.problemId}`).expect(200);
    expect(response.body.progress.attempts).toBe(1);
    expect(response.body.progress.solved).toBe(false);
    expect(response.body.progress.bestPassedCount).toBe(0);
  });

  it('rejects an unknown submission id', async () => {
    await request(app).get('/api/submissions/424242').expect(404);
  });
});
