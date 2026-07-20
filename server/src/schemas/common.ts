import { z } from 'zod';
import mongoose from 'mongoose';
import { PAGINATION, LIMITS } from '../models/constants.js';

/** A syntactically valid Mongo ObjectId, rejected at the edge as a 400. */
export const objectId = z
  .string()
  .refine((value) => mongoose.isValidObjectId(value), { message: 'Invalid id' });

/**
 * Page and limit are genuinely clamped rather than rejected: asking for more
 * than the maximum returns the maximum, which is what a caller means by
 * `?limit=1000`. The cap is what matters — an unbounded `limit` lets one
 * request pull the entire collection.
 */
export const paginationQuery = z.object({
  page: z.coerce
    .number()
    .int()
    .catch(1)
    .transform((value) => Math.min(Math.max(value, 1), PAGINATION.maxPage))
    .default(1),
  limit: z.coerce
    .number()
    .int()
    .catch(PAGINATION.defaultLimit)
    .transform((value) => Math.min(Math.max(value, 1), PAGINATION.maxLimit))
    .default(PAGINATION.defaultLimit),
});

export const searchQuery = z.string().trim().max(LIMITS.search).optional();

export type Pagination = z.infer<typeof paginationQuery>;

/** Standard envelope for every paginated list response. */
export interface Paginated<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export function paginate<T>(items: T[], total: number, { page, limit }: Pagination): Paginated<T> {
  return { items, page, limit, total, totalPages: Math.ceil(total / limit) };
}
