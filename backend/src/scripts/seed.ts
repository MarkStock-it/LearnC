import { migrateUp } from '../db/migrations/index.js';
import { closeDb } from '../db/knex.js';
import * as repo from '../db/repositories.js';
import { verifyTestCases } from '../services/aiService.js';
import { findBankProblem, type BankProblem } from '../services/problemBank.js';
import type { Difficulty } from '../domain/types.js';
import type { GeneratedProblem, GeneratedTestCase } from '../domain/problem.js';
import { logger } from '../utils/logger.js';

interface SetPlan {
  title: string;
  description: string;
  examYear: number;
  examSemester: string;
  difficulty: Difficulty;
  problemKeys: string[];
}

/** Two exam bundles, mirroring the structure described in plan §7.1. */
const SETS: SetPlan[] = [
  {
    title: 'PROG 1 — Midterm 2024',
    description: 'First-half topics: arrays, loops, strings and basic sorting.',
    examYear: 2024,
    examSemester: 'midterm',
    difficulty: 'easy',
    problemKeys: ['array-sum', 'reverse-word', 'count-vowels', 'second-largest', 'sort-descending'],
  },
  {
    title: 'PROG 1 — Finals 2024',
    description: 'Second-half topics: matrices, number theory and string algorithms.',
    examYear: 2024,
    examSemester: 'finals',
    difficulty: 'hard',
    problemKeys: ['matrix-transpose', 'gcd-lcm', 'run-length-encoding'],
  },
];

const argv = process.argv.slice(2);
const force = argv.includes('--force');
const skipVerify = argv.includes('--skip-verify');
const strict = argv.includes('--strict');

function toGeneratedProblem(bank: BankProblem): GeneratedProblem {
  return {
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
    tags: bank.tags,
    difficulty: bank.difficulty,
    reference_solution: bank.referenceSolution,
  };
}

function toGeneratedTestCases(bank: BankProblem): GeneratedTestCase[] {
  return bank.testCases.map((testCase) => ({
    input: testCase.input,
    expected_output: testCase.expectedOutput,
    is_public: testCase.isPublic,
    description: testCase.description,
  }));
}

async function main(): Promise<void> {
  await migrateUp();

  const instructor = await repo.ensureUser('instructor', 'instructor@example.edu');
  const summary: Array<{ set: string; inserted: number; skipped: number; unverified: number }> = [];

  for (const plan of SETS) {
    const existingSets = await repo.listProblemSets(instructor.id);
    const existing = existingSets.find((set) => set.title === plan.title);

    let problemSetId: number;
    if (existing && !force) {
      problemSetId = existing.id;
      logger.info({ problemSetId, title: plan.title }, 'problem set already exists — adding missing problems');
    } else {
      if (existing) {
        // Cascades to problems, test cases and submissions so a re-seed starts clean.
        await repo.deleteProblemSet(existing.id);
        logger.warn({ title: plan.title }, 'force mode: deleting and recreating the problem set');
      }
      problemSetId = await repo.createProblemSet({
        title: plan.title,
        description: plan.description,
        examYear: plan.examYear,
        examSemester: plan.examSemester,
        difficulty: plan.difficulty,
        userId: instructor.id,
      });
      logger.info({ problemSetId, title: plan.title }, 'created problem set');
    }

    const existingProblems = await repo.listProblems({ problemSetId, userId: instructor.id });
    let inserted = 0;
    let skipped = 0;
    let unverified = 0;

    for (const key of plan.problemKeys) {
      const bank = findBankProblem(key);
      if (!bank) {
        logger.error({ key }, 'problem key missing from the bank');
        continue;
      }

      const alreadyThere = existingProblems.find((problem) => problem.title === bank.title);
      if (alreadyThere && !force) {
        skipped += 1;
        continue;
      }

      const generatedProblem = toGeneratedProblem(bank);
      const generatedCases = toGeneratedTestCases(bank);

      if (!skipVerify) {
        const verification = await verifyTestCases(generatedProblem, generatedCases);
        if (!verification.passed) {
          unverified += 1;
          logger.error({ title: bank.title, detail: verification.detail }, 'test cases failed verification — not inserted');
          if (strict) throw new Error(`Verification failed for ${bank.title}: ${verification.detail}`);
          continue;
        }
        logger.debug({ title: bank.title, detail: verification.detail }, 'test cases verified against the reference solution');
      }

      const problemId = await repo.createProblem({
        problemSetId,
        title: bank.title,
        description: bank.description,
        constraints: generatedProblem.constraints,
        sampleInput: bank.sampleInput,
        sampleOutput: bank.sampleOutput,
        difficulty: bank.difficulty,
        tags: bank.tags,
        aiGenerated: false,
        aiPromptParams: { provider: 'offline-bank', key: bank.key, seededAt: new Date().toISOString() },
      });

      await repo.insertTestCases(
        problemId,
        bank.testCases.map((testCase) => ({
          input: testCase.input,
          expectedOutput: testCase.expectedOutput,
          isPublic: testCase.isPublic,
          description: testCase.description,
        })),
      );

      inserted += 1;
      logger.info({ problemId, title: bank.title, testCases: bank.testCases.length }, 'seeded problem');
    }

    summary.push({ set: plan.title, inserted, skipped, unverified });
  }

  logger.info({ summary, verify: !skipVerify }, 'seed complete');
  if (summary.some((entry) => entry.unverified > 0)) {
    logger.warn('some problems were skipped because their expectations failed verification');
    process.exitCode = 1;
  }
}

try {
  await main();
} catch (error) {
  logger.fatal({ err: error instanceof Error ? error.message : String(error) }, 'seed failed');
  process.exitCode = 1;
} finally {
  await closeDb();
}
