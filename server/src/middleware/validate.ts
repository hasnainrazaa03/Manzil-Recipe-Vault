import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z, type ZodType } from 'zod';
import { badRequest } from '../lib/errors.js';

interface Schemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

/** Shape of a validation failure sent to the client. */
function formatIssues(error: z.ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

/**
 * Validates and *replaces* the request parts with their parsed output.
 *
 * Replacing rather than merely checking is the point: handlers downstream only
 * ever see whitelisted, coerced fields. This is what makes mass assignment
 * impossible — an unknown key never reaches the database layer because it never
 * survives the parse.
 */
export function validate(schemas: Schemas): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (schemas.params) {
        req.params = schemas.params.parse(req.params) as typeof req.params;
      }
      if (schemas.query) {
        // Express 5 exposes `req.query` via a getter, so it is redefined rather
        // than assigned.
        const parsed = schemas.query.parse(req.query);
        Object.defineProperty(req, 'query', { value: parsed, configurable: true, writable: true });
      }
      if (schemas.body) {
        req.body = schemas.body.parse(req.body);
      }
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        next(badRequest('Request validation failed', formatIssues(error)));
        return;
      }
      next(error);
    }
  };
}
