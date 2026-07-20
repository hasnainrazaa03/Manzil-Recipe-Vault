import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { aiLimiter } from '../middleware/rateLimit.js';
import { asyncHandler, badRequest } from '../lib/errors.js';
import { geminiConfigured } from '../lib/gemini.js';
import { tidyRecipe } from '../lib/tidyRecipe.js';
import { LIMITS } from '../models/constants.js';

const router = Router();

/**
 * Mirrors the recipe form's own limits. The point is not to protect the model —
 * it is that anything this endpoint accepts must be storable afterwards, and a
 * tidy-up that produces a recipe too big to save has wasted a paid call and the
 * author's time.
 */
const tidyBody = z
  .object({
    title: z.string().trim().max(LIMITS.title).default(''),
    overview: z.string().trim().max(LIMITS.overview).default(''),
    ingredients: z
      .array(
        z.object({
          amount: z.string().trim().max(LIMITS.ingredientAmount).default(''),
          name: z.string().trim().max(LIMITS.ingredientName).default(''),
        }),
      )
      .max(LIMITS.ingredients)
      .default([]),
    instructions: z.string().max(LIMITS.instructions).default(''),
  })
  .strict();

/**
 * GET /api/ai/status — whether the assistant is available at all.
 *
 * The client asks before drawing the button. A key is optional configuration,
 * so the honest outcome of not having one is that the feature is absent, not
 * that it is present and fails when pressed.
 */
router.get('/status', (_req, res) => {
  res.json({ available: geminiConfigured() });
});

/**
 * POST /api/ai/tidy — rewrite rough notes into a presentable recipe.
 *
 * Nothing is saved. The response is a *proposal*: the client shows it beside
 * what the author typed and they accept or discard it. This endpoint has no
 * write access to anything, which is the simplest possible answer to "what if
 * the model gets it wrong" — the author sees it first, every time.
 */
router.post(
  '/tidy',
  aiLimiter,
  requireAuth,
  validate({ body: tidyBody }),
  asyncHandler(async (req, res) => {
    const input = req.body as {
      title: string;
      overview: string;
      ingredients: { amount: string; name: string }[];
      instructions: string;
    };

    const hasIngredients = input.ingredients.some((i) => `${i.amount}${i.name}`.trim() !== '');
    const hasMethod = input.instructions.trim() !== '';

    // A paid round trip to tidy nothing helps no one, and the error a model
    // returns for an empty prompt is far less clear than this one.
    if (!hasIngredients && !hasMethod) {
      throw badRequest('Write some ingredients or a method first, then I can tidy it up.');
    }

    /**
     * Abort the model call if the client goes away — a closed tab, a navigation,
     * a cancelled fetch. An abandoned request should stop costing money the
     * moment it is abandoned rather than running to completion for nobody.
     *
     * Gated on `writableEnded` because `close` also fires on the ordinary path,
     * once the response has been fully sent. Aborting there would be harmless
     * today and a trap for whoever next adds work after `res.json`.
     */
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });

    const result = await tidyRecipe(input, controller.signal);

    res.json(result);
  }),
);

export default router;
