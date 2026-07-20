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
export interface MergeResult {
  items: ShoppingItem[];
  /** How many items could not be kept because the list is full. */
  dropped: number;
}

export function mergeItems(stored: ShoppingItem[], incoming: ShoppingItem[]): MergeResult {
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

  const all = [...merged.values()].sort((a, b) => a.addedAt - b.addedAt);

  if (all.length <= LIMITS.shoppingItems) return { items: all, dropped: 0 };

  /**
   * Over the cap, so something has to go — but *what* goes matters.
   *
   * Sorting oldest-first and truncating meant the items dropped were always the
   * newest, which is always exactly the ones just added. Generating a week's
   * shopping list against a full list therefore reported success and added
   * nothing, and re-running never helped because the ids are stable.
   *
   * Already-ticked items are the ones the reader has finished with, so those go
   * first. Only if that is not enough does anything still needed go, and the
   * caller is told how many so it can say so rather than pretend.
   */
  const unchecked = all.filter((item) => !item.checked);
  const checked = all.filter((item) => item.checked);

  const kept = unchecked.slice(-LIMITS.shoppingItems);
  const room = LIMITS.shoppingItems - kept.length;

  /**
   * Indexed from the front, not with a negative offset.
   *
   * `checked.slice(-room)` reads as "the last `room` items", and is — until
   * `room` is 0, because `-0 === 0` and `slice(0)` returns the *entire* array.
   * The cap was then breached by exactly the number of ticked items, without
   * bound, so a list whose owner kept ticking things off grew forever — while
   * `dropped` confidently reported a truncation that had not happened.
   */
  const keptChecked = checked.slice(checked.length - room);
  const items = [...keptChecked, ...kept].sort((a, b) => a.addedAt - b.addedAt);

  return {
    items,
    // Derived from what actually survived rather than computed independently,
    // so the count cannot disagree with the array it describes.
    dropped: all.length - items.length,
  };
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
    const { items: merged, dropped } = mergeItems(existing?.items ?? [], items);

    const list = await ShoppingList.findOneAndUpdate(
      { user: user.uid },
      { $set: { items: merged } },
      { new: true, upsert: true },
    ).lean();

    res.json({ items: list?.items ?? [], updatedAt: list?.updatedAt ?? null, merged: true, dropped });
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
