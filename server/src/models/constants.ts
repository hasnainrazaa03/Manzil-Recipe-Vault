/**
 * Field limits, defined once and enforced twice: by Zod at the edge (so the
 * client gets a clear 400) and by Mongoose at the model (so nothing written by
 * any other path can exceed them either).
 */
export const LIMITS = {
  title: 140,
  overview: 500,
  instructions: 20_000,
  ingredientName: 120,
  ingredientAmount: 60,
  ingredients: 100,
  tag: 30,
  tags: 12,
  commentText: 2_000,
  displayName: 60,
  bio: 500,
  imageUrl: 2_000,
  search: 100,
  cuisine: 40,
  /** A day. Anything longer is a data-entry mistake, not a slow braise. */
  minutes: 1_440,
  servings: 100,
  /**
   * Bounds the recipe document. Comments are embedded, so without a cap one
   * account posting at the rate limit could push a recipe past MongoDB's 16 MB
   * ceiling — after which every write to it fails, including its owner's edits
   * and any attempt to delete the comments causing the problem.
   */
  commentsPerRecipe: 500,
} as const;

export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const PAGINATION = {
  defaultLimit: 6,
  maxLimit: 50,
  maxPage: 1_000,
} as const;

/** Only these hosts may be used for an image URL pasted by a user. */
export const ALLOWED_IMAGE_HOSTS = [
  'res.cloudinary.com',
  'images.pexels.com',
  'images.unsplash.com',
  'i.imgur.com',
  'lh3.googleusercontent.com',
] as const;
