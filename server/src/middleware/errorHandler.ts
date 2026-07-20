import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { isProduction } from '../config/env.js';

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({
    error: { code: 'not_found', message: `No route for ${req.method} ${req.path}` },
  });
}

/**
 * The single place an error becomes a response. Client-safe errors keep their
 * message; everything else collapses to a generic 500, because raw driver and
 * runtime messages disclose schema and infrastructure detail.
 */
export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (error instanceof AppError) {
    if (error.status >= 500) logger.error({ err: error }, 'Server error');
    res.status(error.status).json({
      error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) },
    });
    return;
  }

  /**
   * body-parser failures are client mistakes. Without this branch a truncated
   * JSON body was logged as an unhandled server fault and answered with a 500,
   * which both alerts on nothing and tells the caller the wrong thing.
   */
  const bodyParserType = (error as { type?: string })?.type;
  if (bodyParserType === 'entity.parse.failed') {
    res.status(400).json({
      error: { code: 'invalid_json', message: 'The request body is not valid JSON' },
    });
    return;
  }
  if (bodyParserType === 'entity.too.large') {
    res.status(413).json({
      error: { code: 'payload_too_large', message: 'The request body is too large' },
    });
    return;
  }

  /**
   * Two documents written concurrently. Mongoose refuses a positional edit
   * against a stale version; the caller should retry rather than be told the
   * server broke.
   */
  if (error instanceof mongoose.Error.VersionError) {
    res.status(409).json({
      error: {
        code: 'conflict',
        message: 'Someone else changed this at the same time. Please try again.',
      },
    });
    return;
  }

  // Duplicate key — most often two concurrent upserts of the same profile.
  if ((error as { code?: number })?.code === 11000) {
    res.status(409).json({
      error: { code: 'conflict', message: 'That already exists. Please try again.' },
    });
    return;
  }

  // A malformed ObjectId is a client mistake, not a server fault.
  if (error instanceof mongoose.Error.CastError) {
    res.status(400).json({
      error: { code: 'invalid_id', message: `'${String(error.value)}' is not a valid ${error.path}` },
    });
    return;
  }

  if (error instanceof mongoose.Error.ValidationError) {
    res.status(400).json({
      error: {
        code: 'validation_failed',
        message: 'The submitted data is not valid',
        details: Object.values(error.errors).map((e) => ({ path: e.path, message: e.message })),
      },
    });
    return;
  }

  logger.error({ err: error, method: req.method, path: req.path }, 'Unhandled error');

  res.status(500).json({
    error: {
      code: 'internal_error',
      message: isProduction
        ? 'Something went wrong. Please try again.'
        : (error as Error)?.message ?? 'Unknown error',
    },
  });
}
