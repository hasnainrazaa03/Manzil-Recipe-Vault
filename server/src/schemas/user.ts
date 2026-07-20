import { z } from 'zod';
import { ALLOWED_IMAGE_HOSTS, LIMITS } from '../models/constants.js';
import { sanitizeText } from '../lib/sanitize.js';
import { paginationQuery } from './common.js';

const pictureUrl = z
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
    { message: 'Profile picture must be an https URL from an allowed host' },
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
    bio: z.string().trim().max(LIMITS.bio).default('').transform(sanitizeText),
    profilePictureUrl: pictureUrl.default(''),
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
