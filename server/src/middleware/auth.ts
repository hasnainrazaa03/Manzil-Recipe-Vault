import type { NextFunction, Request, Response } from 'express';
import { admin } from '../config/firebase.js';
import { unauthorized } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export interface AuthenticatedUser {
  uid: string;
  email?: string;
  name?: string;
}

function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

async function verify(token: string): Promise<AuthenticatedUser> {
  const decoded = await admin.auth().verifyIdToken(token);
  return { uid: decoded.uid, email: decoded.email, name: decoded.name as string | undefined };
}

/** Rejects the request unless a valid Firebase ID token is present. */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token) return next(unauthorized('No authentication token provided'));

  try {
    req.user = await verify(token);
    next();
  } catch (error) {
    // The reason a token failed (expired vs. malformed vs. wrong project) is
    // useful to us and useless-to-harmful to the caller.
    logger.warn({ err: error }, 'ID token verification failed');
    next(unauthorized('Invalid or expired authentication token'));
  }
}

/**
 * Attaches the user when a valid token is present, but lets anonymous requests
 * through. Used by public reads that return extra fields for signed-in callers
 * (their own rating, whether they saved the recipe).
 */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token) return next();

  try {
    req.user = await verify(token);
  } catch {
    // A bad token on an optional route is simply treated as anonymous.
  }
  next();
}

/** Narrows `req.user` for handlers mounted behind `requireAuth`. */
export function requireUser(req: Request): AuthenticatedUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
