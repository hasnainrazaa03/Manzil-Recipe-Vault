import { z } from 'zod';
import { DIFFICULTIES, LIMITS } from '../models/constants.js';
import { sanitizeHtml, sanitizeText } from '../lib/sanitize.js';
import { objectId, paginationQuery, searchQuery } from './common.js';

/**
 * An image is either empty or an https URL.
 *
 * This was briefly restricted to an allow-list of five hosts, which was the
 * wrong call: the app offers "paste an image URL" as a first-class way to
 * illustrate a recipe, and almost every real image lives on a food blog or a
 * newspaper's CDN. The rule did not just reject new pastes — it made recipes
 * *uneditable*, because the client submits the existing image URL back with
 * every save, so an author could no longer fix a typo in a recipe they had
 * illustrated from anywhere but those five domains.
 *
 * What the allow-list actually bought was small: the server never fetches these
 * URLs, so there is no SSRF surface, and requiring https already rules out
 * `javascript:` and `data:`. The residual risk is a third-party host seeing
 * that someone loaded the image, which is addressed where it belongs — the
 * client renders user-supplied images with `referrerPolicy="no-referrer"`.
 *
 * Uploads remain pinned to our own Cloudinary folder; that path is unaffected.
 */
const imageUrl = z
  .string()
  .trim()
  .max(LIMITS.imageUrl)
  .refine(
    (value) => {
      if (value === '') return true;
      try {
        return new URL(value).protocol === 'https:';
      } catch {
        return false;
      }
    },
    { message: 'Image must be a full https:// URL' },
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
/**
 * An optional number that also accepts `null` and `''` — a cleared form field
 * arrives as one or the other, and both mean "not stated".
 */
const optionalCount = (max: number) =>
  z
    // Order matters: Zod takes the first branch that succeeds, and
    // `z.coerce.number()` succeeds on both `null` and `''` — each coerces to 0.
    // With the number first, the null branches were unreachable, so clearing a
    // field stored 0 instead of null and collapsed the "not stated" versus
    // "zero minutes" distinction the model depends on.
    .union([z.null(), z.literal(''), z.coerce.number()])
    .optional()
    .transform((value) => (value === '' || value === null || value === undefined ? null : value))
    .refine((value) => value === null || (Number.isInteger(value) && value >= 0 && value <= max), {
      message: `Must be a whole number between 0 and ${max}`,
    });

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

  // Cooking metadata — all optional; `null` means "not stated".
  servings: optionalCount(LIMITS.servings).refine((v) => v === null || v >= 1, {
    message: 'Servings must be at least 1',
  }),
  prepMinutes: optionalCount(LIMITS.minutes),
  cookMinutes: optionalCount(LIMITS.minutes),
  difficulty: z
    .union([z.null(), z.literal(''), z.enum(DIFFICULTIES)])
    .optional()
    .transform((value) => (value === '' || value === undefined ? null : value)),
  cuisine: z.string().trim().max(LIMITS.cuisine).default('').transform(sanitizeText),
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
    servings: recipeWritableFields.servings.optional(),
    prepMinutes: recipeWritableFields.prepMinutes.optional(),
    cookMinutes: recipeWritableFields.cookMinutes.optional(),
    difficulty: recipeWritableFields.difficulty.optional(),
    cuisine: recipeWritableFields.cuisine.optional(),
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
  sort: z.enum(['newest', 'oldest', 'rating', 'popular', 'relevance', 'quickest']).default('newest'),
  author: z.string().trim().max(128).optional(),
  difficulty: z.enum(DIFFICULTIES).optional(),
  cuisine: z.string().trim().max(LIMITS.cuisine).optional(),
  /** "Under N minutes", matched against the derived total. */
  maxMinutes: z.coerce.number().int().min(1).max(LIMITS.minutes).optional(),
});

export const recipeIdParams = z.object({ id: objectId });

export const commentIdParams = z.object({ id: objectId, commentId: objectId });

export const versionParams = z.object({
  id: objectId,
  version: z.coerce.number().int().min(1),
});

export const commentBody = z
  .object({
    text: z
      .string()
      .trim()
      .min(1, 'Comment cannot be empty')
      .max(LIMITS.commentText)
      .transform(sanitizeText)
      .refine((text) => text.length > 0, { message: 'Comment cannot be empty' }),
    /** Present when this is a reply. One level only; enforced in the handler. */
    parent: objectId.optional(),
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
