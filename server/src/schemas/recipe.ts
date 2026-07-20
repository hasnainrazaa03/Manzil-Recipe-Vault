import { z } from 'zod';
import { ALLOWED_IMAGE_HOSTS, LIMITS } from '../models/constants.js';
import { sanitizeHtml, sanitizeText } from '../lib/sanitize.js';
import { objectId, paginationQuery, searchQuery } from './common.js';

/**
 * An image is either empty or an https URL on a host we trust. Restricting the
 * host stops the field being used to point at attacker-controlled infrastructure
 * (tracking pixels, SSRF bait for any future server-side fetch, malware links).
 */
const imageUrl = z
  .string()
  .trim()
  .max(LIMITS.imageUrl)
  .refine(
    (value) => {
      if (value === '') return true;
      try {
        const url = new URL(value);
        return (
          url.protocol === 'https:' &&
          ALLOWED_IMAGE_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))
        );
      } catch {
        return false;
      }
    },
    { message: `Image must be an https URL from one of: ${ALLOWED_IMAGE_HOSTS.join(', ')}` },
  );

const ingredient = z.object({
  amount: z.string().trim().max(LIMITS.ingredientAmount).default('').transform(sanitizeText),
  name: z.string().trim().min(1, 'Ingredient name is required').max(LIMITS.ingredientName).transform(sanitizeText),
});

/**
 * Tags arrive either as an array (current client) or a comma-separated string
 * (older client). Both normalise to a deduplicated, lower-cased array.
 */
const tags = z
  .union([z.array(z.string()), z.string()])
  .default([])
  .transform((value) => (Array.isArray(value) ? value : value.split(',')))
  .transform((list) =>
    Array.from(
      new Set(
        list
          .map((tag) => sanitizeText(tag).trim().toLowerCase())
          .filter((tag) => tag.length > 0 && tag.length <= LIMITS.tag),
      ),
    ).slice(0, LIMITS.tags),
  );

/**
 * The writable surface of a recipe. `author`, `authorEmail`, `ratings`,
 * `averageRating`, `ratingCount` and `comments` are deliberately absent — they
 * are set by the server, and because `validate()` replaces the body with this
 * schema's output, a client cannot smuggle them through.
 */
const recipeWritableFields = {
  title: z.string().trim().min(1, 'Title is required').max(LIMITS.title).transform(sanitizeText),
  image: imageUrl.default(''),
  overview: z.string().trim().min(1, 'Overview is required').max(LIMITS.overview).transform(sanitizeText),
  ingredients: z.array(ingredient).max(LIMITS.ingredients).default([]),
  instructions: z
    .string()
    .min(1, 'Instructions are required')
    .max(LIMITS.instructions)
    .transform(sanitizeHtml)
    .refine((html) => sanitizeText(html).length > 0, { message: 'Instructions are required' }),
  tags,
};

export const createRecipeBody = z.object(recipeWritableFields).strict();

/** Every field optional, but still strictly whitelisted. */
export const updateRecipeBody = z
  .object({
    title: recipeWritableFields.title.optional(),
    image: imageUrl.optional(),
    overview: recipeWritableFields.overview.optional(),
    ingredients: z.array(ingredient).max(LIMITS.ingredients).optional(),
    instructions: recipeWritableFields.instructions.optional(),
    tags: tags.optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: 'No fields to update' });

export const listRecipesQuery = paginationQuery.extend({
  search: searchQuery,
  /** Repeatable: `?tag=vegan&tag=quick`. */
  tag: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((value) => {
      if (value === undefined) return undefined;
      const list = (Array.isArray(value) ? value : [value])
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, LIMITS.tags);
      return list.length > 0 ? list : undefined;
    }),
  /** With multiple tags: match recipes having *all* of them, or *any*. */
  tagMode: z.enum(['any', 'all']).default('any'),
  sort: z.enum(['newest', 'oldest', 'rating', 'popular', 'relevance']).default('newest'),
  author: z.string().trim().max(128).optional(),
});

export const recipeIdParams = z.object({ id: objectId });

export const commentIdParams = z.object({ id: objectId, commentId: objectId });

export const commentBody = z
  .object({
    text: z
      .string()
      .trim()
      .min(1, 'Comment cannot be empty')
      .max(LIMITS.commentText)
      .transform(sanitizeText)
      .refine((text) => text.length > 0, { message: 'Comment cannot be empty' }),
  })
  .strict();

export const ratingBody = z
  .object({
    score: z.coerce
      .number()
      .int('Rating must be a whole number')
      .min(1, 'Rating must be between 1 and 5')
      .max(5, 'Rating must be between 1 and 5'),
  })
  .strict();

export type CreateRecipeBody = z.infer<typeof createRecipeBody>;
export type UpdateRecipeBody = z.infer<typeof updateRecipeBody>;
export type ListRecipesQuery = z.infer<typeof listRecipesQuery>;
