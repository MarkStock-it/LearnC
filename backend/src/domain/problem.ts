import { z } from 'zod';
import { DIFFICULTIES } from './types.js';

/** Constraint envelope stored on `problems.constraints` (plan §3.1). */
export const problemConstraintsSchema = z.object({
  time_limit_seconds: z.number().min(1).max(60).default(5),
  memory_limit_mb: z.number().min(16).max(1024).default(256),
  input_format: z.string().default(''),
  output_format: z.string().default(''),
  sample_input: z.string().default(''),
  sample_output: z.string().default(''),
});

export type ProblemConstraints = z.infer<typeof problemConstraintsSchema>;

export const DEFAULT_CONSTRAINTS: ProblemConstraints = problemConstraintsSchema.parse({});

/** Structured-output contract for problem generation (plan §4.1 + §4.3). */
export const generatedProblemSchema = z.object({
  title: z.string().min(5).max(255),
  description: z.string().min(40),
  constraints: problemConstraintsSchema,
  tags: z.array(z.string().min(1).max(40)).min(1).max(6),
  difficulty: z.enum(DIFFICULTIES).default('medium'),
  /** Optional: the AI is invited to include a reference solution so test cases can be verified. */
  reference_solution: z.string().optional(),
});

export type GeneratedProblem = z.infer<typeof generatedProblemSchema>;

/** Structured-output contract for test case generation (plan §4.2). */
export const generatedTestCaseSchema = z.object({
  input: z.string(),
  expected_output: z.string(),
  is_public: z.boolean(),
  description: z.string().max(255).default(''),
});

export const generatedTestCasesSchema = z.object({
  test_cases: z.array(generatedTestCaseSchema).min(1).max(24),
});

export type GeneratedTestCase = z.infer<typeof generatedTestCaseSchema>;

/** Response shape for the admin generation endpoint. */
export interface GeneratedProblemBundle {
  problem: GeneratedProblem;
  testCases: GeneratedTestCase[];
  /** How the expectations were validated, surfaced to the admin caller. */
  verification: {
    attempted: boolean;
    passed: boolean;
    detail: string;
    source: 'reference-solution' | 'sample-only' | 'skipped';
  };
}
