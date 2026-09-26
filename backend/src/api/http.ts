import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, type ZodType } from 'zod';
import { logger } from '../utils/logger.js';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static badRequest(message: string, details?: unknown): ApiError {
    return new ApiError(400, message, details);
  }

  static notFound(message: string): ApiError {
    return new ApiError(404, message);
  }

  static unauthorized(message: string): ApiError {
    return new ApiError(401, message);
  }

  static serviceUnavailable(message: string): ApiError {
    return new ApiError(503, message);
  }
}

/** Wrap an async route so rejections reach the error middleware. */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}

/** Validate with Zod and surface a clean 400 instead of leaking schema internals. */
export function parseWith<T>(schema: ZodType<T>, value: unknown, source: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw ApiError.badRequest(`Invalid ${source}`, formatZodError(result.error));
  }
  return result.data;
}

function formatZodError(error: ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => ({
    path: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
}

export function notFoundHandler(): RequestHandler {
  return (req: Request, res: Response) => {
    res.status(404).json({ error: { message: `No route for ${req.method} ${req.path}`, status: 404 } });
  };
}

export function errorHandler(): (error: unknown, req: Request, res: Response, next: NextFunction) => void {
  return (error, req, res, _next) => {
    if (error instanceof ApiError) {
      res.status(error.status).json({
        error: { message: error.message, status: error.status, details: error.details ?? undefined },
      });
      return;
    }

    if (error instanceof ZodError) {
      res.status(400).json({
        error: { message: 'Invalid request', status: 400, details: formatZodError(error) },
      });
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    logger.error({ err: message, method: req.method, path: req.path }, 'unhandled API error');
    res.status(500).json({ error: { message: 'Internal server error', status: 500 } });
  };
}
