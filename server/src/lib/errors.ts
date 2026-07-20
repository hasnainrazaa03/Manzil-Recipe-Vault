import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * An error that is safe to show the client. Anything thrown that is *not* an
 * AppError is treated as an internal fault and its message is withheld.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, message: string, code = 'error', details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, message, 'bad_request', details);

export const unauthorized = (message = 'Authentication required') =>
  new AppError(401, message, 'unauthorized');

export const forbidden = (message = 'You do not have permission to do that') =>
  new AppError(403, message, 'forbidden');

export const notFound = (message = 'Not found') => new AppError(404, message, 'not_found');

export const conflict = (message: string) => new AppError(409, message, 'conflict');

/**
 * Express 5 forwards rejected promises to the error handler on its own, but
 * wrapping keeps the behaviour explicit and survives a downgrade.
 */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
