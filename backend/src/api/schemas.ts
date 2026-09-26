import { z } from 'zod';
import { config } from '../config.js';
import { DIFFICULTIES, SUBMISSION_STATUSES } from '../domain/types.js';

export const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const listProblemsQuerySchema = z.object({
  problemSetId: z.coerce.number().int().positive().optional(),
  difficulty: z.enum(DIFFICULTIES).optional(),
  tag: z.string().trim().min(1).max(40).optional(),
  search: z.string().trim().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const createSubmissionSchema = z.object({
  problemId: z.coerce.number().int().positive(),
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
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const generateProblemSchema = z.object({
  problemSetId: z.coerce.number().int().positive().optional(),
  problemSetTitle: z.string().trim().min(3).max(255).optional(),
  examYear: z.coerce.number().int().min(1990).max(2100).optional(),
  examSemester: z.string().trim().max(10).optional(),
  difficulty: z.enum(DIFFICULTIES).default('medium'),
  topics: z.array(z.string().trim().min(1).max(40)).min(1).max(6),
  testCaseCount: z.coerce.number().int().min(3).max(20).default(8),
  publicTestCaseCount: z.coerce.number().int().min(1).max(6).default(3),
  /** Optionally persist the generated problem instead of only returning it. */
  persist: z.boolean().default(true),
});

export type CreateSubmissionInput = z.infer<typeof createSubmissionSchema>;
export type GenerateProblemInput = z.infer<typeof generateProblemSchema>;
