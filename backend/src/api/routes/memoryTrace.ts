import { Router } from 'express';
import { z } from 'zod';
import { ApiError, asyncHandler, parseWith } from '../http.js';
import { config } from '../../config.js';
import { findAccessibleProblem } from '../../db/repositories.js';
import { traceMemory } from '../../services/memoryTrace.js';

export const memoryTraceRouter = Router();

const traceSchema = z.object({
  problemId: z.coerce.number().int().positive(),
  code: z.string().min(1).max(config.http.maxCodeBytes),
  stdin: z.string().max(16_384).default(''),
});

memoryTraceRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const ownerId = req.sessionAuthenticated ? req.user!.id : null;
    const body = parseWith(traceSchema, req.body, 'request body');
    const problem = await findAccessibleProblem(body.problemId, ownerId);
    if (!problem) throw ApiError.notFound(`Problem ${body.problemId} does not exist`);
    const response = await traceMemory({
      code: body.code,
      stdin: body.stdin,
      limits: {
        timeLimitMs: Math.min(Math.max(problem.constraints.time_limit_seconds * 1000, 250), config.executor.timeLimitMs),
        memoryLimitMb: Math.min(problem.constraints.memory_limit_mb, 1024),
        pidsLimit: config.executor.pidsLimit,
        maxOutputBytes: Math.min(config.executor.maxOutputBytes, 16_384),
      },
    });
    res.json(response);
  }),
);
