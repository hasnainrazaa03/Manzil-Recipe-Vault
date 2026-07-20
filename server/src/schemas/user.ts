import { z } from 'zod';
import { LIMITS } from '../models/constants.js';
import { sanitizeText } from '../lib/sanitize.js';
import { paginationQuery } from './common.js';

/** See the note on `imageUrl` in schemas/recipe.ts for why this is not host-restricted. */
const pictureUrl = z
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
    { message: 'Profile picture must be a full https:// URL' },
  );

export const updateProfileBody = z
  .object({
    displayName: z
      .string()
      .trim()
      .min(1, 'Display name is required')
      .max(LIMITS.displayName)
      .transform(sanitizeText)
      .refine((name) => name.length > 0, { message: 'Display name is required' }),
    // Optional rather than defaulted: with `.default('')` an omitted key became
    // `$set: { bio: '' }`, so a partial body silently wiped fields the caller
    // never mentioned. The handler only sets what was actually sent.
    bio: z.string().trim().max(LIMITS.bio).transform(sanitizeText).optional(),
    profilePictureUrl: pictureUrl.optional(),
  })
  .strict();

/** Firebase uids are opaque strings, not ObjectIds. */
export const userIdParams = z.object({
  userId: z.string().trim().min(1).max(128),
});

export const profileQuery = paginationQuery;

export const uploadSignatureBody = z
  .object({
    /** Which flow the signature is for; each pins its own folder. */
    kind: z.enum(['recipe', 'avatar']).default('recipe'),
  })
  .strict();

export type UpdateProfileBody = z.infer<typeof updateProfileBody>;
