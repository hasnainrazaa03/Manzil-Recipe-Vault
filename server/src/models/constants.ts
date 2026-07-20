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
} as const;

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
