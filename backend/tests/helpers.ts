import { migrateUp } from '../src/db/migrations/index.js';
import { db } from '../src/db/knex.js';
import * as repo from '../src/db/repositories.js';
import { findBankProblem } from '../src/services/problemBank.js';
import { config } from '../src/config.js';

/** Create the schema in the throwaway test database. */
export async function prepareDatabase(): Promise<void> {
  await migrateUp();
  if (!config.db.sqliteFile.includes('c-practice-tests')) {
    throw new Error(`Refusing to run tests against ${config.db.sqliteFile} — expected the test database`);
  }
}

export async function resetDatabase(): Promise<void> {
  const conn = db();
  for (const table of ['submission_results', 'submissions', 'test_cases', 'problems', 'problem_sets', 'users']) {
    await conn(table).delete();
  }
}

export interface Fixture {
  problemSetId: number;
  problemId: number;
  testCaseIds: number[];
  referenceSolution: string;
}

/**
 * Seed one problem from the curated bank. Using the bank's reference solution as the
 * "correct" submission keeps the test independent of any hand-written expected output.
 */
export async function seedFixture(bankKey = 'array-sum'): Promise<Fixture> {
  const bank = findBankProblem(bankKey);
  if (!bank) throw new Error(`Unknown bank problem: ${bankKey}`);

  const user = await repo.ensureUser('guest', 'guest@example.edu');
  const problemSetId = await repo.createProblemSet({
    title: `Fixture set (${bank.key})`,
    description: 'Created by the test suite',
    examYear: 2024,
    examSemester: 'test',
    difficulty: bank.difficulty,
    userId: user.id,
  });

  const problemId = await repo.createProblem({
    problemSetId,
    title: bank.title,
    description: bank.description,
    constraints: {
      time_limit_seconds: bank.timeLimitSeconds,
      memory_limit_mb: bank.memoryLimitMb,
      input_format: bank.inputFormat,
      output_format: bank.outputFormat,
      sample_input: bank.sampleInput,
      sample_output: bank.sampleOutput,
    },
    sampleInput: bank.sampleInput,
    sampleOutput: bank.sampleOutput,
    difficulty: bank.difficulty,
    tags: bank.tags,
    aiGenerated: false,
  });

  const testCaseIds = await repo.insertTestCases(
    problemId,
    bank.testCases.map((testCase) => ({
      input: testCase.input,
      expectedOutput: testCase.expectedOutput,
      isPublic: testCase.isPublic,
      description: testCase.description,
    })),
  );

  return { problemSetId, problemId, testCaseIds, referenceSolution: bank.referenceSolution };
}

export function testDatabasePath(): string {
  return config.db.sqliteFile;
}
