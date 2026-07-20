import type { AuthenticatedUser } from '../middleware/auth.js';

declare global {
  namespace Express {
    interface Request {
      /** Set by `requireAuth`; optionally set by `optionalAuth`. */
      user?: AuthenticatedUser;
    }
  }
}

export {};
