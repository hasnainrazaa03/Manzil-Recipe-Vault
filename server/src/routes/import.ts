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

    /**
     * Accept a bare domain the way a browser address bar would — but only when
     * there is no scheme at all. Prepending `https://` to `file:///etc/passwd`
     * produced `https://file:///etc/passwd`, which was still refused, but as a
     * DNS failure rather than as the bad protocol it actually is. The caller
     * deserves the real reason.
     */
    /**
     * The negative lookahead is what distinguishes a scheme from a host and
     * port: a scheme may legally contain dots, so `cooking.example.net:8080`
     * matched a naive scheme pattern and was reported as an unsupported
     * protocol — about a perfectly ordinary https link. A colon followed by
     * digits is a port; anything else is a scheme.
     */
    const hasScheme = /^[a-z][a-z0-9+.-]*:(?!\d)/i.test(url);
    const normalised = hasScheme ? url : `https://${url}`;

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
