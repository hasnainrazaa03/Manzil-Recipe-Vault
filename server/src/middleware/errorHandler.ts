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
