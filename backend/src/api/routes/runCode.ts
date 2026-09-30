import { Router } from 'express';
import { z } from 'zod';
import { config } from '../../config.js';
import { findAccessibleProblem } from '../../db/repositories.js';
import { getExecutor } from '../../services/executor/index.js';
import { ApiError, asyncHandler, parseWith } from '../http.js';
import { parseFilesPayload, sourceFileSchema, validateFileSet } from '../../domain/sourceFiles.js';

export const runCodeRouter = Router();

const runCodeSchema = z.object({
  problemId: z.coerce.number().int().positive(),
  code: z.string().min(1).max(config.http.maxCodeBytes),
  stdin: z.string().max(16_384).default(''),
  files: z.array(sourceFileSchema).min(1).max(20).optional(),
  entryFile: z.string().max(80).optional(),
});

/** Run exactly once against learner-provided stdin; unlike /submissions this is never graded or persisted. */
runCodeRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const ownerId = req.sessionAuthenticated ? req.user!.id : null;
    const body = parseWith(runCodeSchema, req.body, 'request body');
    const problem = await findAccessibleProblem(body.problemId, ownerId);
    if (!problem) throw ApiError.notFound(`Problem ${body.problemId} does not exist`);

    const filePayload = body.files
      ? { files: body.files, entryFile: body.entryFile ?? 'solution.c' }
      : parseFilesPayload(body.code);
    if (filePayload) {
      try {
        validateFileSet(filePayload.entryFile, filePayload.files);
      } catch (error) {
        throw ApiError.badRequest(error instanceof Error ? error.message : 'Invalid source file set');
      }
    }

    const { executor } = await getExecutor();
    const outcome = await executor.execute({
      code: filePayload?.files.find((file) => file.filename === filePayload.entryFile)?.content ?? body.code,
      ...(filePayload ? { files: filePayload.files, entryFile: filePayload.entryFile } : {}),
      testCases: [{ id: 1, inputData: body.stdin, expectedOutput: '' }],
      limits: {
        timeLimitMs: Math.min(
          Math.max(problem.constraints.time_limit_seconds * 1000, 250),
          config.executor.timeLimitMs,
        ),
        memoryLimitMb: Math.min(problem.constraints.memory_limit_mb, 1024),
        pidsLimit: config.executor.pidsLimit,
        maxOutputBytes: Math.min(config.executor.maxOutputBytes, 16_384),
      },
    });

    if (!outcome.compiled) {
      res.json({
        status: 'compilation_error',
        compilationError: outcome.compilationError,
        compilerOutput: outcome.compilerOutput,
        stdout: '',
        stderr: '',
        runtimeMs: null,
        executor: outcome.executor,
      });
      return;
    }

    const run = outcome.runs[0];
    if (!run) throw new Error('The sandbox returned no result for the single run');

    res.json({
      status: run.errorType === 'TIMEOUT' ? 'timeout' : run.errorType === 'RUNTIME_ERROR' ? 'runtime_error' : 'completed',
      compilationError: null,
      compilerOutput: outcome.compilerOutput,
      stdout: run.actualOutput,
      stderr: run.stderr,
      runtimeMs: run.runtimeMs,
      executor: outcome.executor,
    });
  }),
);
