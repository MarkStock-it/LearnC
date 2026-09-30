import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import * as authRepo from '../src/db/authRepositories.js';
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

async function fixtureToken(): Promise<string> {
  const guest = await repo.ensureUser('guest');
  return authRepo.issueToken(guest.id);
}

async function submitAndWait(code: string, expectedStatus = 202): Promise<Record<string, unknown>> {
  const token = await fixtureToken();
  const created = await request(app)
    .post('/api/submissions')
    .set('Authorization', `Bearer ${token}`)
    .send({ problemId: fixture.problemId, code })
    .expect(expectedStatus);

  const submissionId = created.body.submissionId as number;
  // Deterministic wait instead of a sleep loop: the inline queue exposes awaitIdle.
  await getQueue().awaitIdle?.(90_000);

  const detail = await request(app).get(`/api/submissions/${submissionId}`).set('Authorization', `Bearer ${token}`).expect(200);
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

describe('POST /api/memory-trace', () => {
  it('registers the trace endpoint and returns instrumented runtime steps', async () => {
    const response = await request(app)
      .post('/api/memory-trace')
      .set('Authorization', `Bearer ${await fixtureToken()}`)
      .send({
        problemId: fixture.problemId,
        code: `int main(void) {
  int value = 4;
  value = value + 1;
  return 0;
}`,
        stdin: '',
      })
      .expect(200);

    expect(response.body.traceable).toBe(true);
    expect(response.body.steps.length).toBeGreaterThanOrEqual(2);
    expect(response.body.steps[0].variables.find((variable: { name: string }) => variable.name === 'value')?.value).toBe('4');
  });
});

describe('POST /api/run-code', () => {
  it('runs the draft once with custom stdin and does not create a submission', async () => {
    const code = `#include <stdio.h>
int main(void) {
    int value;
    if (scanf("%d", &value) != 1) return 2;
    printf("value=%d\\n", value * 3);
    return 0;
}`;
    const response = await request(app)
      .post('/api/run-code')
      .set('Authorization', `Bearer ${await fixtureToken()}`)
      .send({ problemId: fixture.problemId, code, stdin: '14\n' })
      .expect(200);

    expect(response.body).toMatchObject({
      status: 'completed',
      compilationError: null,
      stdout: 'value=42\n',
      stderr: '',
    });
    expect(response.body.runtimeMs).toEqual(expect.any(Number));
    expect(response.body.executor).toMatch(/^(docker|local)$/);
    expect(response.body).not.toHaveProperty('results');

    const history = await request(app).get('/api/submissions?mine=true').set('Authorization', `Bearer ${await fixtureToken()}`).expect(200);
    expect(history.body.count).toBe(0);
  });

  it('returns compiler diagnostics for code that does not compile', async () => {
    const response = await request(app)
      .post('/api/run-code')
      .set('Authorization', `Bearer ${await fixtureToken()}`)
      .send({ problemId: fixture.problemId, code: WILL_NOT_COMPILE, stdin: '' })
      .expect(200);

    expect(response.body.status).toBe('compilation_error');
    expect(response.body.compilationError).toContain('oops_not_declared');
    expect(response.body.stdout).toBe('');
  });

  it('reports runtime failures and program stderr', async () => {
    const response = await request(app)
      .post('/api/run-code')
      .set('Authorization', `Bearer ${await fixtureToken()}`)
      .send({
        problemId: fixture.problemId,
        code: '#include <stdio.h>\nint main(void) { fputs("debug info\\n", stderr); return 3; }\n',
        stdin: '',
      })
      .expect(200);

    expect(response.body.status).toBe('runtime_error');
    expect(response.body.stderr).toContain('debug info');
  });

  it('stops code that exceeds the problem time limit', async () => {
    const response = await request(app)
      .post('/api/run-code')
      .set('Authorization', `Bearer ${await fixtureToken()}`)
      .send({ problemId: fixture.problemId, code: INFINITE_LOOP, stdin: '' })
      .expect(200);

    expect(response.body.status).toBe('timeout');
    expect(response.body.runtimeMs).toEqual(expect.any(Number));
  });

  it('validates input and rejects an unknown problem', async () => {
    await request(app).post('/api/run-code').send({ problemId: fixture.problemId, code: '' }).expect(400);
    await request(app)
      .post('/api/run-code')
      .send({ problemId: fixture.problemId, code: CORRECT, stdin: 'x'.repeat(16_385) })
      .expect(400);
    await request(app)
      .post('/api/run-code')
      .send({ problemId: 999999, code: CORRECT, stdin: '' })
      .expect(404);
  });
});

describe('account authentication', () => {
  it('keeps leaderboard participation private by default and exposes only opted-in solve counts', async () => {
    const privateUser = await repo.ensureUser('private-student');
    const publicUser = await repo.ensureUser('public-student');
    const privateToken = authRepo.issueToken(privateUser.id);
    const publicToken = authRepo.issueToken(publicUser.id);
    const solvedId = await repo.createSubmission({ userId: publicUser.id, problemId: fixture.problemId, code: CORRECT });
    await repo.updateSubmission(solvedId, { status: 'COMPLETED', passedCount: 7, totalCount: 7 });

    const defaultSettings = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${privateToken}`).expect(200);
    expect(defaultSettings.body.ai.leaderboardPublic).toBe(false);
    const hidden = await request(app).get('/api/dashboard/leaderboard').expect(200);
    expect(hidden.body).toMatchObject({ total: 0, entries: [] });

    await request(app).put('/api/auth/leaderboard-settings').set('Authorization', `Bearer ${publicToken}`).send({ isPublic: true }).expect(200);
    const leaderboard = await request(app).get('/api/dashboard/leaderboard?limit=10&offset=0').expect(200);
    expect(leaderboard.body.total).toBe(1);
    expect(leaderboard.body.entries).toEqual([{ rank: 1, username: 'public-student', solvedProblems: 1 }]);
    expect(leaderboard.body.entries[0]).not.toHaveProperty('userId');
    expect(leaderboard.body.entries[0]).not.toHaveProperty('id');

    await request(app).put('/api/auth/leaderboard-settings').send({ isPublic: true }).expect(401);
    await request(app).put('/api/auth/leaderboard-settings').set('Authorization', `Bearer ${publicToken}`).send({ isPublic: false }).expect(200);
    expect((await request(app).get('/api/dashboard/leaderboard')).body.total).toBe(0);
  });

  it('allows the same account to log in again when the client still sends its legacy username header', async () => {
    const credentials = { username: 'repeat-login', password: 'correct-horse-battery' };
    const registered = await request(app)
      .post('/api/auth/register')
      .set('Authorization', `Bearer ${credentials.username}`)
      .send(credentials)
      .expect(201);

    await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${registered.body.token}`)
      .expect(204);

    const loggedIn = await request(app)
      .post('/api/auth/login')
      .set('Authorization', `Bearer ${credentials.username}`)
      .send(credentials)
      .expect(200);

    expect(loggedIn.body.user.username).toBe(credentials.username);
    await request(app).get('/api/auth/me').set('Authorization', `Bearer ${loggedIn.body.token}`).expect(200);
  });

  it('rejects an incorrect password', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ username: 'wrong-password', password: 'correct-horse-battery' })
      .expect(201);

    await request(app)
      .post('/api/auth/login')
      .send({ username: 'wrong-password', password: 'incorrect-password' })
      .expect(401);
  });

  it('keeps browser guest history separate from an account history', async () => {
    const account = await repo.ensureUser('progress-account');
    const submissionId = await repo.createSubmission({ userId: account.id, problemId: fixture.problemId, code: CORRECT });
    await repo.updateSubmission(submissionId, {
      status: 'COMPLETED',
      passedCount: 7,
      totalCount: 7,
      completedAt: new Date().toISOString(),
    });

    const accountStats = await request(app)
      .get('/api/dashboard/stats')
      .set('Authorization', `Bearer ${authRepo.issueToken(account.id)}`)
      .expect(200);
    expect(accountStats.body.stats.completedSubmissions).toBe(1);

    await request(app).get('/api/dashboard/stats').expect(401);
    await request(app).get('/api/submissions?mine=true').expect(401);
  });
});

describe('problem discovery', () => {
  it('lists only the requesting user’s bundles with counts and paginates filtered results', async () => {
    const response = await request(app).get('/api/problem-sets').expect(200);
    expect(response.body.count).toBe(0);
    expect(response.body.total).toBe(0);

    const owner = await repo.ensureUser('guest');
    const ownerToken = authRepo.issueToken(owner.id);
    const secondId = await repo.createProblemSet({ title: 'Second array practice', userId: owner.id });
    await repo.createProblem({
      problemSetId: secondId,
      title: 'Second array task',
      description: 'Another array practice problem.',
      constraints: { time_limit_seconds: 2, memory_limit_mb: 256, input_format: 'n', output_format: 'n', sample_input: '1', sample_output: '1' },
      sampleInput: '1', sampleOutput: '1', difficulty: 'easy', tags: ['arrays'], aiGenerated: false,
    });

    const owned = await request(app).get('/api/problem-sets?limit=1&offset=0').set('Authorization', `Bearer ${ownerToken}`).expect(200);
    expect(owned.body.count).toBe(1);
    expect(owned.body.total).toBe(2);
    expect(owned.body.problemSets[0]).toMatchObject({ problemCount: 1 });
    const filtered = await request(app).get('/api/problem-sets?tag=arrays&limit=1&offset=1').set('Authorization', `Bearer ${ownerToken}`).expect(200);
    expect(filtered.body.total).toBe(2);
    expect(filtered.body.problemSets).toHaveLength(1);
    expect((await request(app).get('/api/problem-sets?offset=-1').set('Authorization', `Bearer ${ownerToken}`)).status).toBe(400);
  });

  it('requires a signed session to publish, lists only opt-in public bundles, and supports forking', async () => {
    const owner = await repo.ensureUser('guest');
    const ownerToken = authRepo.issueToken(owner.id);
    await request(app).post(`/api/problem-sets/${fixture.problemSetId}/publish`).send({ isPublic: true }).expect(401);
    await request(app).post(`/api/problem-sets/${fixture.problemSetId}/publish`).set('Authorization', `Bearer ${ownerToken}`).send({ isPublic: true }).expect(200);

    const publicList = await request(app).get('/api/public-bundles?limit=1&offset=0').expect(200);
    expect(publicList.body.count).toBe(1);
    expect(publicList.body.total).toBe(1);
    expect(publicList.body.problemSets[0]).toMatchObject({ isPublic: true, creatorName: 'guest', userId: null });
    const browse = await request(app).get(`/api/public-bundles?tag=arrays&difficulty=easy`).expect(200);
    expect(browse.body.count).toBe(1);
    await request(app).get(`/api/problems?problemSetId=${fixture.problemSetId}`).expect(200).expect(({ body }) => expect(body.count).toBe(1));
    await request(app).get(`/api/problems/${fixture.problemId}`).expect(200);
    await request(app).get(`/api/public-bundles/${fixture.problemSetId}?limit=1&offset=0`).expect(200).expect(({ body }) => {
      expect(body.problemSet.userId).toBeNull();
      expect(body.problems).toHaveLength(1);
      expect(body.totalProblems).toBe(1);
    });
    await request(app).get(`/api/problem-sets/${fixture.problemSetId}`).expect(200).expect(({ body }) => {
      expect(body.problemSet.userId).toBeNull();
      expect(body.problemSet.creatorName).toBe('guest');
    });

    const foreign = await repo.ensureUser('foreign-viewer');
    await request(app).get('/api/problem-sets').set('Authorization', `Bearer ${authRepo.issueToken(foreign.id)}`).expect(200).expect(({ body }) => expect(body.count).toBe(0));
    await request(app).get(`/api/problems?problemSetId=${fixture.problemSetId}`).set('Authorization', `Bearer ${authRepo.issueToken(foreign.id)}`).expect(200).expect(({ body }) => expect(body.count).toBe(1));
    await request(app).get(`/api/problems/${fixture.problemId}`).set('Authorization', `Bearer ${authRepo.issueToken(foreign.id)}`).expect(200);

    const other = await repo.ensureUser('bundle-forker');
    const otherToken = authRepo.issueToken(other.id);
    await request(app).post(`/api/problem-sets/${fixture.problemSetId}/fork`).set('Authorization', `Bearer ${otherToken}`).send({}).expect(201);
    const privateCopy = await request(app).get('/api/problem-sets').set('Authorization', `Bearer ${otherToken}`).expect(200);
    expect(privateCopy.body.count).toBe(1);
    expect(privateCopy.body.problemSets[0].title).toContain('(copy)');
    expect((await request(app).get('/api/public-bundles')).body.count).toBe(1);

    await request(app).post(`/api/problem-sets/${fixture.problemSetId}/publish`).set('Authorization', `Bearer ${ownerToken}`).send({ isPublic: false }).expect(200);
    expect((await request(app).get('/api/public-bundles')).body.count).toBe(0);
    await request(app).get(`/api/problems/${fixture.problemId}`).expect(404);
    await request(app).get(`/api/problems?problemSetId=${fixture.problemSetId}`).expect(404);
    await request(app).get(`/api/problems/${fixture.problemId}`).expect(404);
    await request(app).get(`/api/problems?problemSetId=${fixture.problemSetId}`).expect(404);
  });

  it('lists problems with tag, difficulty, search, and pagination filters', async () => {
    const all = await request(app).get('/api/problems').expect(200);
    expect(all.body.count).toBe(0);
    const owner = await repo.ensureUser('guest');
    const ownerToken = authRepo.issueToken(owner.id);
    await repo.createProblem({
      problemSetId: fixture.problemSetId,
      title: 'Second array task',
      description: 'Another clear exercise about arrays and indices.',
      constraints: { time_limit_seconds: 2, memory_limit_mb: 256, input_format: 'n', output_format: 'n', sample_input: '1', sample_output: '1' },
      sampleInput: '1', sampleOutput: '1', difficulty: 'easy', tags: ['arrays'], aiGenerated: false,
    });
    const owned = await request(app).get('/api/problems?limit=1&offset=0').set('Authorization', `Bearer ${ownerToken}`).expect(200);
    expect(owned.body.count).toBe(1);
    expect(owned.body.total).toBe(2);
    const secondPage = await request(app).get('/api/problems?limit=1&offset=1').set('Authorization', `Bearer ${ownerToken}`).expect(200);
    expect(secondPage.body.total).toBe(2);
    expect(secondPage.body.problems).toHaveLength(1);
    expect((await request(app).get('/api/problems?limit=1&offset=2').set('Authorization', `Bearer ${ownerToken}`)).body.problems).toHaveLength(0);

    const matching = await request(app).get('/api/problems?tag=arrays&difficulty=easy').set('Authorization', `Bearer ${ownerToken}`).expect(200);
    expect(matching.body.count).toBe(2);

    const notMatching = await request(app).get('/api/problems?tag=matrices').set('Authorization', `Bearer ${ownerToken}`).expect(200);
    expect(notMatching.body.count).toBe(0);

    const searched = await request(app).get('/api/problems?search=Array').set('Authorization', `Bearer ${ownerToken}`).expect(200);
    expect(searched.body.count).toBe(2);
  });

  it('exposes public samples but never hidden test cases', async () => {
    const owner = await repo.ensureUser('guest');
    const response = await request(app).get(`/api/problems/${fixture.problemId}`).set('Authorization', `Bearer ${authRepo.issueToken(owner.id)}`).expect(200);
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

  it('hides private problems from other accounts and rejects spoofed identities', async () => {
    const other = await repo.ensureUser('problem-viewer');
    const response = await request(app).get(`/api/problems/${fixture.problemId}`).set('Authorization', `Bearer ${authRepo.issueToken(other.id)}`).expect(403);
    expect(response.body.problem).toBeUndefined();
    await request(app).get('/api/problem-sets').set('x-user-id', String(other.id)).expect(200).expect(({ body }) => expect(body.count).toBe(0));
    await request(app).get(`/api/problems/${fixture.problemId}`).set('x-user-id', String(other.id)).expect(404);
    await request(app).get('/api/problem-sets').set('Authorization', 'Bearer problem-viewer').expect(401);
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
    const token = await fixtureToken();
    await request(app).post('/api/submissions').set('Authorization', `Bearer ${token}`).send({ problemId: fixture.problemId, code: '' }).expect(400);
    await request(app)
      .post('/api/submissions').set('Authorization', `Bearer ${token}`)
      .send({ problemId: 'not-a-number', code: 'int main(void){return 0;}' })
      .expect(400);
    await request(app)
      .post('/api/submissions').set('Authorization', `Bearer ${token}`)
      .send({ problemId: 999999, code: 'int main(void){return 0;}' })
      .expect(404);
  });

  it('refuses to grade a problem with no test cases', async () => {
    const user = await repo.ensureUser('empty-instructor');
    const setId = await repo.createProblemSet({ title: 'Empty set', userId: user.id });
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
      .set('Authorization', `Bearer ${authRepo.issueToken(user.id)}`)
      .send({ problemId, code: 'int main(void){return 0;}' })
      .expect(422);
    expect(response.body.error.message).toMatch(/no test cases/i);
  });
});

describe('history and progress', () => {
  it('keeps each user’s history separate and provides a paginated total', async () => {
    await submitAndWait(CORRECT);
    const guest = await repo.ensureUser('guest');
    const secondId = await repo.createSubmission({ userId: guest.id, problemId: fixture.problemId, code: OFF_BY_ONE });
    await repo.updateSubmission(secondId, { status: 'FAILED' });
    const token = authRepo.issueToken(guest.id);

    const guestHistory = await request(app).get('/api/submissions?mine=true&limit=1&offset=0').set('Authorization', `Bearer ${token}`).expect(200);
    expect(guestHistory.body.count).toBe(1);
    expect(guestHistory.body.total).toBe(2);
    expect(guestHistory.body.offset).toBe(0);
    expect(guestHistory.body.submissions[0].problemTitle).toBe(bank.title);
    expect(guestHistory.body.submissions[0].tags).toEqual(bank.tags);
    const nextPage = await request(app).get('/api/submissions?mine=false&limit=1&offset=1').set('Authorization', `Bearer ${token}`).expect(200);
    expect(nextPage.body.total).toBe(2);
    expect(nextPage.body.submissions).toHaveLength(1);
    expect(nextPage.body.submissions[0].tags).toEqual(bank.tags);
    expect((await request(app).get('/api/submissions?status=FAILED&limit=10').set('Authorization', `Bearer ${token}`)).body.total).toBe(1);

    const other = await repo.ensureUser('other-student');
    const otherHistory = await request(app)
      .get('/api/submissions?mine=true')
      .set('Authorization', `Bearer ${authRepo.issueToken(other.id)}`)
      .expect(200);
    expect(otherHistory.body.count).toBe(0);
  });

  it('keeps submission details private to their author', async () => {
    const body = await submitAndWait(CORRECT);
    const submissionId = (body.submission as Record<string, unknown>).id as number;

    // The author can read their own submission back.
    await request(app).get(`/api/submissions/${submissionId}`).set('Authorization', `Bearer ${await fixtureToken()}`).expect(200);

    // Another account gets a 404 (not 403) so ids can't be probed for existence.
    const other = await repo.ensureUser('other-student');
    await request(app)
      .get(`/api/submissions/${submissionId}`)
      .set('Authorization', `Bearer ${authRepo.issueToken(other.id)}`)
      .expect(404);
  });

  it('reports dashboard progress for the requesting user', async () => {
    await submitAndWait(CORRECT);

    const response = await request(app).get('/api/dashboard/stats').set('Authorization', `Bearer ${await fixtureToken()}`).expect(200);
    expect(response.body.stats.totalSubmissions).toBe(1);
    expect(response.body.stats.solvedProblems).toBe(1);
    expect(response.body.stats.solvedProblemIds).toContain(fixture.problemId);
    expect(response.body.recentSubmissions[0].problemTitle).toBe(bank.title);
  });

  it('records per-problem progress on the problem page', async () => {
    await submitAndWait(OFF_BY_ONE);
    const owner = await repo.ensureUser('guest');
    const response = await request(app).get(`/api/problems/${fixture.problemId}`).set('Authorization', `Bearer ${authRepo.issueToken(owner.id)}`).expect(200);
    expect(response.body.progress.attempts).toBe(1);
    expect(response.body.progress.solved).toBe(false);
    expect(response.body.progress.bestPassedCount).toBe(0);
  });

  it('rejects an unknown submission id', async () => {
    await request(app).get('/api/submissions/424242').set('Authorization', `Bearer ${await fixtureToken()}`).expect(404);
  });
});
