import { Router } from 'express';
import { z } from 'zod';
import { ShoppingList, type ShoppingItem } from '../models/ShoppingList.js';
import { requireAuth, requireUser } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { readLimiter, writeLimiter } from '../middleware/rateLimit.js';
import { asyncHandler } from '../lib/errors.js';
import { sanitizeText } from '../lib/sanitize.js';
import { LIMITS } from '../models/constants.js';

const router = Router();

const item = z.object({
  id: z.string().trim().min(1).max(200),
  amount: z.string().trim().max(LIMITS.ingredientAmount).default('').transform(sanitizeText),
  name: z.string().trim().min(1).max(LIMITS.ingredientName).transform(sanitizeText),
  recipeId: z.string().trim().max(64).default(''),
  recipeTitle: z.string().trim().max(LIMITS.title).default('').transform(sanitizeText),
  checked: z.boolean().default(false),
  addedAt: z.number().int().nonnegative().default(() => Date.now()),
});

const replaceBody = z.object({ items: z.array(item).max(LIMITS.shoppingItems) }).strict();
const mergeBody = z.object({ items: z.array(item).max(LIMITS.shoppingItems) }).strict();

/**
 * Reconciles a local list with the stored one.
 *
 * The rule that matters: **nothing is ever dropped.** Signing in must not
 * silently discard a list built while signed out — someone standing in a shop
 * with a list that just emptied itself is worse off than with no list at all.
 *
 * Items are matched by `id`, which the client generates deterministically from
 * the recipe and ingredient, so the same ingredient added on two devices is one
 * item. On a genuine conflict the *checked* state wins if either side has it
 * ticked, because un-ticking something you already bought is a smaller
 * annoyance than buying it twice.
 */
export function mergeItems(stored: ShoppingItem[], incoming: ShoppingItem[]): ShoppingItem[] {
  const merged = new Map<string, ShoppingItem>();

  for (const existing of stored) merged.set(existing.id, existing);

  for (const candidate of incoming) {
    const existing = merged.get(candidate.id);

    if (!existing) {
      merged.set(candidate.id, candidate);
      continue;
    }

    merged.set(candidate.id, {
      ...existing,
      // The most recently added wording of the amount wins — it is the one the
      // reader last saw, and rescaling changes it.
      ...(candidate.addedAt >= existing.addedAt ? { amount: candidate.amount } : {}),
      checked: existing.checked || candidate.checked,
      addedAt: Math.min(existing.addedAt, candidate.addedAt),
    });
  }

  return [...merged.values()]
    .sort((a, b) => a.addedAt - b.addedAt)
    .slice(0, LIMITS.shoppingItems);
}

/** GET /api/shopping-list */
router.get(
  '/',
  readLimiter,
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const list = await ShoppingList.findOne({ user: user.uid }).lean();

    res.json({ items: list?.items ?? [], updatedAt: list?.updatedAt ?? null });
  }),
);

/**
 * PUT /api/shopping-list — replace outright.
 *
 * Used for ordinary edits made while online, where the client already holds the
 * authoritative list.
 */
router.put(
  '/',
  writeLimiter,
  requireAuth,
  validate({ body: replaceBody }),
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const { items } = req.body as { items: ShoppingItem[] };

    const list = await ShoppingList.findOneAndUpdate(
      { user: user.uid },
      { $set: { items } },
      { new: true, upsert: true },
    ).lean();

    res.json({ items: list?.items ?? [], updatedAt: list?.updatedAt ?? null });
  }),
);

/**
 * POST /api/shopping-list/merge — reconcile a local list with the stored one.
 *
 * Called on sign-in, when the browser may be holding items the server has never
 * seen.
 */
router.post(
  '/merge',
  writeLimiter,
  requireAuth,
  validate({ body: mergeBody }),
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const { items } = req.body as { items: ShoppingItem[] };

    const existing = await ShoppingList.findOne({ user: user.uid }).lean();
    const merged = mergeItems(existing?.items ?? [], items);

    const list = await ShoppingList.findOneAndUpdate(
      { user: user.uid },
      { $set: { items: merged } },
      { new: true, upsert: true },
    ).lean();

    res.json({ items: list?.items ?? [], updatedAt: list?.updatedAt ?? null, merged: true });
  }),
);

router.delete(
  '/',
  writeLimiter,
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    await ShoppingList.updateOne({ user: user.uid }, { $set: { items: [] } }, { upsert: true });

    res.json({ items: [], cleared: true });
  }),
);

export default router;
