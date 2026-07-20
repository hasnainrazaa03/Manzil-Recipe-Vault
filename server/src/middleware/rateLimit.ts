import rateLimit, { ipKeyGenerator, type Options } from 'express-rate-limit';
import type { Request } from 'express';
import { isTest } from '../config/env.js';

/**
 * Authenticated callers are limited per-uid so that everyone behind one NAT or
 * mobile carrier gateway does not share a bucket. Anonymous callers fall back
 * to IP — via the library's helper, which collapses an IPv6 address to its /64
 * prefix. A raw `req.ip` key would let one IPv6 client rotate through addresses
 * in its own subnet and never hit a limit.
 */
function keyGenerator(req: Request): string {
  return req.user?.uid ?? ipKeyGenerator(req.ip ?? '') ?? 'unknown';
}

function make(options: Pick<Options, 'windowMs' | 'limit'> & { message: string }) {
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.limit,
    keyGenerator,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Rate limiting would make test runs flaky and tests non-independent.
    skip: () => isTest,
    handler: (_req, res) => {
      res.status(429).json({ error: { code: 'rate_limited', message: options.message } });
    },
  });
}

/** Broad ceiling for read traffic. */
export const readLimiter = make({
  windowMs: 15 * 60 * 1000,
  limit: 600,
  message: 'Too many requests. Please slow down.',
});

/** Creating and editing content. */
export const writeLimiter = make({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  message: 'Too many changes in a short period. Please wait a few minutes.',
});

/** Comments and ratings — the cheapest actions to abuse. */
export const interactionLimiter = make({
  windowMs: 5 * 60 * 1000,
  limit: 30,
  message: 'You are posting too quickly. Please wait a moment.',
});

/**
 * Upload signatures are the most sensitive thing we mint: each one is a token
 * to write into our Cloudinary account.
 */
export const uploadLimiter = make({
  windowMs: 60 * 60 * 1000,
  limit: 40,
  message: 'Upload limit reached. Please try again later.',
});
