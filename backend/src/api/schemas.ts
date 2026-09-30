import { z } from 'zod';
import { config } from '../config.js';
import { DIFFICULTIES, SUBMISSION_STATUSES } from '../domain/types.js';
import { sourceFileSchema } from '../domain/sourceFiles.js';

export const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const listProblemsQuerySchema = z.object({
  problemSetId: z.coerce.number().int().positive().optional(),
  difficulty: z.enum(DIFFICULTIES).optional(),
  tag: z.string().trim().min(1).max(40).optional(),
  search: z.string().trim().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});

export const createSubmissionSchema = z.object({
  problemId: z.coerce.number().int().positive(),
  files: z.array(sourceFileSchema).min(1).max(20).optional(),
  entryFile: z.string().max(80).optional(),
  code: z
    .string()
    .min(1, 'Code cannot be empty')
    .max(
      config.http.maxCodeBytes,
      `Code exceeds the ${Math.round(config.http.maxCodeBytes / 1024)} KB limit`,
    ),
});

export const listSubmissionsQuerySchema = z.object({
  problemId: z.coerce.number().int().positive().optional(),
  status: z.enum(SUBMISSION_STATUSES).optional(),
  mine: z
    .union([z.literal('true'), z.literal('false'), z.boolean()])
    .transform((value) => value === true || value === 'true')
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});

export const generateProblemSchema = z.object({
  problemSetId: z.coerce.number().int().positive().optional(),
  problemSetTitle: z.string().trim().min(3).max(255).optional(),
  examYear: z.coerce.number().int().min(1990).max(2100).optional(),
  examSemester: z.string().trim().max(10).optional(),
  difficulty: z.enum(DIFFICULTIES).default('medium'),
  topics: z.array(z.string().trim().min(1).max(40)).min(1).max(6),
  excludeProblemIds: z.array(z.coerce.number().int().positive()).max(200).default([]),
  testCaseCount: z.coerce.number().int().min(6).max(24).default(8),
  publicTestCaseCount: z.coerce.number().int().min(1).max(6).default(3),
  /** Optionally persist the generated problem instead of only returning it. */
  persist: z.boolean().default(true),
  /** Per-request Gemini model override. */
  geminiModel: z.string().trim().regex(/^gemini-[a-z0-9.-]+$/i).max(60).optional(),
  /** Compact generation: one merged call instead of problem + cases. */
  compact: z.boolean().default(true),
  /** Practice-quiz customisation (shape of the generated problem). */
  quiz: z
    .object({
      /** Count of practice items to produce (1-5 problems). */
      problemCount: z.coerce.number().int().min(1).max(5).default(1),
      /** Free-form learner intent, e.g. "focus on nested loops, avoid strings". */
      instructions: z.string().trim().max(400).optional(),
      /** Avoid repeating these problem titles in this quiz. */
      avoidTitles: z.array(z.string().trim().max(120)).max(20).default([]),
      /** Put the generated problems in their own quiz set titled this way. */
      quizTitle: z.string().trim().min(3).max(120).optional(),
    })
    .default({ problemCount: 1, avoidTitles: [] }),
});

export type CreateSubmissionInput = z.infer<typeof createSubmissionSchema>;
export type GenerateProblemInput = z.infer<typeof generateProblemSchema>;
export type QuizOptions = NonNullable<GenerateProblemInput['quiz']>;
