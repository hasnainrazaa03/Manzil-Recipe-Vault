import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler, AppError } from '../lib/errors.js';
import { fetchPublicPage } from '../lib/safeFetch.js';
import { parseRecipeFromHtml } from '../lib/parseRecipe.js';
import { importLimiter } from '../middleware/rateLimit.js';

const router = Router();

const importBody = z
  .object({ url: z.string().trim().min(1, 'Paste a link first').max(2_000) })
  .strict();

/**
 * POST /api/import — read a recipe from a URL.
 *
 * Returns parsed fields for the form to fill in. It deliberately does **not**
 * create a recipe: the user reviews and edits first, which stops a bad parse
 * silently producing rubbish and keeps attribution honest, since they can see
 * what was taken and from where.
 *
 * Authenticated and rate limited harder than anything else, because each call
 * makes an outbound request from our network on the caller's behalf.
 */
router.post(
  '/',
  importLimiter,
  requireAuth,
  validate({ body: importBody }),
  asyncHandler(async (req, res) => {
    const { url } = req.body as { url: string };

    // Accept a bare domain the way a browser address bar would.
    const normalised = /^https?:\/\//i.test(url) ? url : `https://${url}`;

    const { html, finalUrl } = await fetchPublicPage(normalised);
    const recipe = parseRecipeFromHtml(html, finalUrl);

    if (!recipe) {
      throw new AppError(
        422,
        'No recipe found on that page. Some sites do not publish one in a readable format — you can still add it by hand.',
        'no_recipe_found',
      );
    }

    res.json(recipe);
  }),
);

export default router;
