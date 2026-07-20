import { Router } from 'express';
import { z } from 'zod';
import { MealPlan } from '../models/MealPlan.js';
import { Recipe, RECIPE_LIST_PROJECTION } from '../models/Recipe.js';
import { ShoppingList } from '../models/ShoppingList.js';
import { requireAuth, requireUser } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { readLimiter, writeLimiter } from '../middleware/rateLimit.js';
import { asyncHandler, badRequest, conflict, notFound } from '../lib/errors.js';
import { publicRecipes } from '../lib/serialize.js';
import { mergeItems } from './shopping-list.js';
import { objectId } from '../schemas/common.js';
import { DATE_PATTERN, MEAL_TYPES, isInWeek, isValidDate, startOfWeek, weekDates } from '../lib/weeks.js';
import { LIMITS } from '../models/constants.js';
import { scaleAmount } from '../lib/amount.js';

const router = Router();

const isoDate = z
  .string()
  .trim()
  .regex(DATE_PATTERN, 'Dates must look like 2026-07-20')
  .refine(isValidDate, { message: 'That is not a real date' });

const weekQuery = z.object({ week: isoDate.optional() });

const entryBody = z
  .object({
    date: isoDate,
    mealType: z.enum(MEAL_TYPES),
    recipe: objectId,
    servings: z
      .union([z.null(), z.literal(''), z.coerce.number()])
      .optional()
      .transform((value) => (value === '' || value === null || value === undefined ? null : value))
      .refine((value) => value === null || (Number.isInteger(value) && value >= 1 && value <= LIMITS.servings), {
        message: `Servings must be a whole number between 1 and ${LIMITS.servings}`,
      }),
  })
  .strict();

/** Loads a week's plan with its recipes resolved, without leaking any email. */
async function loadWeek(user: string, weekStart: string) {
  const plan = await MealPlan.findOne({ user, weekStart }).lean();
  const entries = plan?.entries ?? [];

  const recipes = await Recipe.find({ _id: { $in: entries.map((entry) => entry.recipe) } })
    .select(RECIPE_LIST_PROJECTION)
    .lean();

  const byId = new Map(
    publicRecipes(recipes as unknown as Record<string, unknown>[]).map((recipe) => [
      String((recipe as { _id: unknown })._id),
      recipe,
    ]),
  );

  return {
    weekStart,
    days: weekDates(weekStart),
    entries: entries
      // A recipe deleted after being planned leaves an entry pointing at
      // nothing. Dropping it on read keeps the week renderable; the tidy-up
      // happens whenever the plan is next written.
      .filter((entry) => byId.has(String(entry.recipe)))
      .map((entry) => ({
        _id: String(entry._id),
        date: entry.date,
        mealType: entry.mealType,
        servings: entry.servings ?? null,
        recipe: byId.get(String(entry.recipe)),
      })),
  };
}

/** GET /api/meal-plan?week=YYYY-MM-DD — defaults to the current week. */
router.get(
  '/',
  readLimiter,
  requireAuth,
  validate({ query: weekQuery }),
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const { week } = req.query as unknown as { week?: string };

    const weekStart = startOfWeek(week ?? new Date().toISOString().slice(0, 10));

    res.json(await loadWeek(user.uid, weekStart));
  }),
);

/**
 * POST /api/meal-plan/entries — put a recipe on a day.
 *
 * Adding the same recipe to the same meal twice is a no-op rather than an
 * error: the outcome the user asked for is already true.
 */
router.post(
  '/entries',
  writeLimiter,
  requireAuth,
  validate({ body: entryBody }),
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const entry = req.body as { date: string; mealType: string; recipe: string; servings: number | null };

    const exists = await Recipe.exists({ _id: entry.recipe });
    if (!exists) throw notFound('Recipe not found');

    const weekStart = startOfWeek(entry.date);

    const plan = await MealPlan.findOneAndUpdate(
      { user: user.uid, weekStart },
      { $setOnInsert: { user: user.uid, weekStart } },
      { new: true, upsert: true },
    );

    const already = plan.entries.some(
      (existing) =>
        existing.date === entry.date &&
        existing.mealType === entry.mealType &&
        String(existing.recipe) === entry.recipe,
    );

    if (!already) {
      if (plan.entries.length >= LIMITS.mealPlanEntries) {
        throw conflict(`A week can hold at most ${LIMITS.mealPlanEntries} meals.`);
      }
      plan.entries.push(entry as never);
      await plan.save();
    }

    res.status(already ? 200 : 201).json(await loadWeek(user.uid, weekStart));
  }),
);

/** PATCH /api/meal-plan/entries/:entryId — change how many it is cooked for. */
router.patch(
  '/entries/:entryId',
  writeLimiter,
  requireAuth,
  validate({
    params: z.object({ entryId: objectId }),
    body: z.object({ servings: entryBody.shape.servings }).strict(),
  }),
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const { entryId } = req.params as { entryId: string };
    const { servings } = req.body as { servings: number | null };

    const plan = await MealPlan.findOne({ user: user.uid, 'entries._id': entryId });
    if (!plan) throw notFound('That meal is not in your plan');

    const entry = plan.entries.id(entryId);
    if (!entry) throw notFound('That meal is not in your plan');

    entry.servings = servings;
    await plan.save();

    res.json(await loadWeek(user.uid, plan.weekStart));
  }),
);

router.delete(
  '/entries/:entryId',
  writeLimiter,
  requireAuth,
  validate({ params: z.object({ entryId: objectId }) }),
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const { entryId } = req.params as { entryId: string };

    const plan = await MealPlan.findOneAndUpdate(
      { user: user.uid, 'entries._id': entryId },
      { $pull: { entries: { _id: entryId } } },
      { new: true },
    ).lean();

    if (!plan) throw notFound('That meal is not in your plan');

    res.json(await loadWeek(user.uid, plan.weekStart));
  }),
);

/**
 * POST /api/meal-plan/shopping-list — add a week's ingredients to the list.
 *
 * Quantities are scaled to whatever each meal is being cooked for, using the
 * same parser the recipe page uses, so the list matches what the plan actually
 * says rather than what each recipe was originally written for.
 *
 * The result is *merged* rather than replacing the list, which means running
 * this twice for the same week is harmless — the item ids are derived from the
 * recipe and ingredient, so the second run recognises what is already there.
 */
router.post(
  '/shopping-list',
  writeLimiter,
  requireAuth,
  validate({ query: weekQuery }),
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const { week } = req.query as unknown as { week?: string };
    const weekStart = startOfWeek(week ?? new Date().toISOString().slice(0, 10));

    const plan = await MealPlan.findOne({ user: user.uid, weekStart }).lean();
    const entries = (plan?.entries ?? []).filter((entry) => isInWeek(entry.date, weekStart));

    if (entries.length === 0) {
      throw badRequest('There is nothing planned for that week yet');
    }

    const recipes = await Recipe.find({ _id: { $in: entries.map((entry) => entry.recipe) } })
      .select('title ingredients servings')
      .lean();
    const byId = new Map(recipes.map((recipe) => [String(recipe._id), recipe]));

    const now = Date.now();
    const items = entries.flatMap((entry) => {
      const recipe = byId.get(String(entry.recipe));
      if (!recipe) return [];

      const base = recipe.servings ?? 0;
      const wanted = entry.servings ?? base;
      const factor = base > 0 && wanted > 0 ? wanted / base : 1;

      return recipe.ingredients
        .filter((ingredient) => (ingredient.name ?? '').trim() !== '')
        .map((ingredient, index) => ({
          // Deterministic, so re-running the same week merges rather than
          // duplicating — and so the same recipe planned twice in a week
          // contributes one line, not two.
          id: `${String(recipe._id)}-${index}`,
          amount: scaleAmount(ingredient.amount ?? '', factor),
          name: ingredient.name ?? '',
          recipeId: String(recipe._id),
          recipeTitle: recipe.title,
          checked: false,
          addedAt: now,
        }));
    });

    const list = await ShoppingList.findOne({ user: user.uid }).lean();
    const merged = mergeItems(list?.items ?? [], items as never);

    const saved = await ShoppingList.findOneAndUpdate(
      { user: user.uid },
      { $set: { items: merged } },
      { new: true, upsert: true },
    ).lean();

    res.json({ items: saved?.items ?? [], added: items.length, meals: entries.length });
  }),
);

export default router;
