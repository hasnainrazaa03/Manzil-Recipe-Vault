import { z } from 'zod';
import { LIMITS } from '../models/constants.js';
import { sanitizeText } from '../lib/sanitize.js';
import { objectId, paginationQuery } from './common.js';

const name = z
  .string()
  .trim()
  .min(1, 'A collection needs a name')
  .max(LIMITS.collectionName)
  .transform(sanitizeText)
  .refine((value) => value.length > 0, { message: 'A collection needs a name' });

const description = z
  .string()
  .trim()
  .max(LIMITS.collectionDescription)
  .transform(sanitizeText);

export const createCollectionBody = z
  .object({
    name,
    description: description.default(''),
    isPublic: z.boolean().default(false),
    /** Optional seed, so "save this into a new collection" is one request. */
    recipes: z.array(objectId).max(LIMITS.recipesPerCollection).default([]),
  })
  .strict();

/**
 * Every field optional, and none defaulted — an omitted key must mean "leave it
 * alone", not "reset it". Defaulting here is what made `PUT /api/users/me`
 * silently wipe fields a partial body did not mention.
 */
export const updateCollectionBody = z
  .object({
    name: name.optional(),
    description: description.optional(),
    isPublic: z.boolean().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: 'No fields to update' });

export const collectionIdParams = z.object({ id: objectId });

export const collectionRecipeParams = z.object({ id: objectId, recipeId: objectId });

export const listCollectionsQuery = paginationQuery.extend({
  /** `me` for your own (including private), or a uid for their public ones. */
  owner: z.string().trim().max(128).default('me'),
});

export type CreateCollectionBody = z.infer<typeof createCollectionBody>;
export type UpdateCollectionBody = z.infer<typeof updateCollectionBody>;
