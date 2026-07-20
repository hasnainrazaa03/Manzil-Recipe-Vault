import { beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MealPlan } from '../src/models/MealPlan.js';
import { ShoppingList } from '../src/models/ShoppingList.js';
import { Recipe } from '../src/models/Recipe.js';
import { LIMITS } from '../src/models/constants.js';
import { api, authHeader, createRecipe, expectNoEmailLeak } from './helpers.js';

/**
 * The meal planner, end to end (DESIGN.md §6.2).
 *
 * Two things are load-bearing and get the most attention: weeks are keyed by a
 * `YYYY-MM-DD` Monday rather than a timestamp, and generating a week's shopping
 * list is *merged* into the existing list, so doing it twice is harmless.
 */

const USER = 'planner-uid';
const OTHER = 'other-planner-uid';

const auth = authHeader(USER);
const otherAuth = authHeader(OTHER);

// 2026-07-20 is a Monday. Every fixture below lives in that week.
const MONDAY = '2026-07-20';
const TUESDAY = '2026-07-21';
const SUNDAY = '2026-07-26';
const NEXT_MONDAY = '2026-07-27';

/** Today's Monday, computed here rather than borrowed from the module under test. */
function currentMonday(): string {
  const today = new Date();
  const utc = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 12),
  );
  const day = utc.getUTCDay();
  utc.setUTCDate(utc.getUTCDate() + (day === 0 ? -6 : 1 - day));
  return utc.toISOString().slice(0, 10);
}

interface EntryOverrides {
  date?: string;
  mealType?: string;
  recipe?: string;
  servings?: number | null;
}

async function addEntry(recipeId: string, overrides: EntryOverrides = {}, as = auth) {
  return api()
    .post('/api/meal-plan/entries')
    .set(as)
    .send({ date: MONDAY, mealType: 'dinner', recipe: recipeId, ...overrides });
}

/** Asserts an error response really is the status and code we expect. */
function expectError(res: { status: number; body: unknown }, status: number, code: string) {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  expect((res.body as { error?: { code?: string } }).error?.code).toBe(code);
}

let recipeId: string;

beforeEach(async () => {
  const recipe = await createRecipe({ title: 'Biryani', servings: 4 });
  recipeId = String(recipe._id);
});

// === Reading a week ==========================================================

describe('GET /api/meal-plan', () => {
  it('defaults to the current week and returns seven days', async () => {
    const res = await api().get('/api/meal-plan').set(auth);

    expect(res.status).toBe(200);
    expect(res.body.weekStart).toBe(currentMonday());
    expect(res.body.days).toHaveLength(7);
    expect(res.body.days[0]).toBe(res.body.weekStart);
    expect(res.body.entries).toEqual([]);
  });

  it('normalises any day of the week to that week’s Monday', async () => {
    for (const day of [MONDAY, TUESDAY, '2026-07-24', SUNDAY]) {
      const res = await api().get('/api/meal-plan').query({ week: day }).set(auth);
      expect(res.status, day).toBe(200);
      expect(res.body.weekStart, `?week=${day}`).toBe(MONDAY);
      expect(res.body.days).toEqual([
        '2026-07-20',
        '2026-07-21',
        '2026-07-22',
        '2026-07-23',
        '2026-07-24',
        '2026-07-25',
        '2026-07-26',
      ]);
    }
  });

  it('treats the following Monday as a different week', async () => {
    const res = await api().get('/api/meal-plan').query({ week: NEXT_MONDAY }).set(auth);
    expect(res.body.weekStart).toBe(NEXT_MONDAY);
  });

  it('rejects a malformed week with 400', async () => {
    for (const week of ['not-a-date', '2026-13-01', '2026-02-30', '2026-7-1', '20-07-2026']) {
      const res = await api().get('/api/meal-plan').query({ week }).set(auth);
      expectError(res, 400, 'bad_request');
    }
  });

  it('leaks no email address', async () => {
    await addEntry(recipeId);
    const res = await api().get('/api/meal-plan').query({ week: MONDAY }).set(auth);
    expectNoEmailLeak(res.body);
  });
});

// === Authentication ==========================================================

describe('authentication', () => {
  const routes = [
    ['get', '/api/meal-plan'],
    ['post', '/api/meal-plan/entries'],
    ['patch', `/api/meal-plan/entries/${new mongoose.Types.ObjectId().toString()}`],
    ['delete', `/api/meal-plan/entries/${new mongoose.Types.ObjectId().toString()}`],
    ['post', '/api/meal-plan/shopping-list'],
  ] as const;

  it('requires a token on every route', async () => {
    for (const [method, path] of routes) {
      const res = await api()[method](path).send({});
      expectError(res, 401, 'unauthorized');
    }
  });

  it('rejects a token it cannot verify', async () => {
    for (const [method, path] of routes) {
      const res = await api()[method](path).set({ Authorization: 'Bearer garbage' }).send({});
      expectError(res, 401, 'unauthorized');
    }
  });
});

// === Adding =================================================================

describe('POST /api/meal-plan/entries', () => {
  it('puts a recipe on a day and returns the week containing it', async () => {
    const res = await addEntry(recipeId, { date: TUESDAY, mealType: 'lunch' });

    expect(res.status).toBe(201);
    expect(res.body.weekStart).toBe(MONDAY);
    expect(res.body.entries).toHaveLength(1);
    expect(res.body.entries[0]).toMatchObject({
      date: TUESDAY,
      mealType: 'lunch',
      servings: null,
    });
    expect(res.body.entries[0].recipe._id).toBe(recipeId);
    expect(res.body.entries[0].recipe.title).toBe('Biryani');
    expectNoEmailLeak(res.body);
  });

  it('is a no-op returning 200 when the same recipe is added to the same meal twice', async () => {
    const first = await addEntry(recipeId, { date: TUESDAY, mealType: 'dinner' });
    expect(first.status).toBe(201);

    const second = await addEntry(recipeId, { date: TUESDAY, mealType: 'dinner' });
    expect(second.status).toBe(200);
    expect(second.body.entries).toHaveLength(1);

    const plan = await MealPlan.findOne({ user: USER, weekStart: MONDAY }).lean();
    expect(plan?.entries).toHaveLength(1);
  });

  it('still adds the same recipe to a different meal or a different day', async () => {
    await addEntry(recipeId, { date: TUESDAY, mealType: 'dinner' });
    const otherMeal = await addEntry(recipeId, { date: TUESDAY, mealType: 'lunch' });
    const otherDay = await addEntry(recipeId, { date: MONDAY, mealType: 'dinner' });

    expect(otherMeal.status).toBe(201);
    expect(otherDay.status).toBe(201);
    expect(otherDay.body.entries).toHaveLength(3);
  });

  it('creates a separate plan document for a day in a different week', async () => {
    await addEntry(recipeId, { date: TUESDAY });
    const next = await addEntry(recipeId, { date: '2026-07-29' });

    expect(next.status).toBe(201);
    expect(next.body.weekStart).toBe(NEXT_MONDAY);
    expect(next.body.entries).toHaveLength(1);
    expect(await MealPlan.countDocuments({ user: USER })).toBe(2);

    // The first week is untouched.
    const first = await api().get('/api/meal-plan').query({ week: MONDAY }).set(auth);
    expect(first.body.entries).toHaveLength(1);
    expect(first.body.entries[0].date).toBe(TUESDAY);
  });

  it('reuses one document for the whole week', async () => {
    await addEntry(recipeId, { date: MONDAY });
    await addEntry(recipeId, { date: SUNDAY });
    expect(await MealPlan.countDocuments({ user: USER })).toBe(1);
  });

  it('404s for a recipe that does not exist', async () => {
    const res = await addEntry(new mongoose.Types.ObjectId().toString());
    expectError(res, 404, 'not_found');
    expect(await MealPlan.countDocuments()).toBe(0);
  });

  it('400s on a malformed recipe id, date or meal type', async () => {
    expectError(await addEntry('not-an-id'), 400, 'bad_request');
    expectError(await addEntry(recipeId, { date: '2026-02-30' }), 400, 'bad_request');
    expectError(await addEntry(recipeId, { mealType: 'brunch' }), 400, 'bad_request');
    expectError(await addEntry(recipeId, { servings: 0 }), 400, 'bad_request');
    expectError(await addEntry(recipeId, { servings: LIMITS.servings + 1 }), 400, 'bad_request');
  });

  it('accepts an explicit servings count', async () => {
    const res = await addEntry(recipeId, { servings: 8 });
    expect(res.status).toBe(201);
    expect(res.body.entries[0].servings).toBe(8);
  });

  it('409s once the week is full', async () => {
    const filler = Array.from({ length: LIMITS.mealPlanEntries }, (_, index) => ({
      date: MONDAY,
      mealType: 'dinner',
      recipe: recipeId,
      // Distinct servings so nothing here is mistaken for the duplicate case;
      // the duplicate check keys on date + mealType + recipe only, so the new
      // entry below uses a different recipe.
      servings: (index % LIMITS.servings) + 1,
    }));
    await MealPlan.create({ user: USER, weekStart: MONDAY, entries: filler });

    const another = await createRecipe({ title: 'Karahi' });
    const res = await addEntry(String(another._id), { date: SUNDAY });

    expectError(res, 409, 'conflict');
    expect(res.body.error.message).toMatch(String(LIMITS.mealPlanEntries));

    const plan = await MealPlan.findOne({ user: USER, weekStart: MONDAY }).lean();
    expect(plan?.entries).toHaveLength(LIMITS.mealPlanEntries);
  });
});

// === Servings ================================================================

describe('PATCH /api/meal-plan/entries/:entryId', () => {
  async function seedEntry() {
    const res = await addEntry(recipeId, { date: TUESDAY, servings: 2 });
    return res.body.entries[0]._id as string;
  }

  it('sets the servings', async () => {
    const entryId = await seedEntry();
    const res = await api()
      .patch(`/api/meal-plan/entries/${entryId}`)
      .set(auth)
      .send({ servings: 6 });

    expect(res.status).toBe(200);
    expect(res.body.weekStart).toBe(MONDAY);
    expect(res.body.entries[0].servings).toBe(6);
  });

  it('clears the servings back to "as written" with null', async () => {
    const entryId = await seedEntry();
    const res = await api()
      .patch(`/api/meal-plan/entries/${entryId}`)
      .set(auth)
      .send({ servings: null });

    expect(res.status).toBe(200);
    expect(res.body.entries[0].servings).toBeNull();

    const plan = await MealPlan.findOne({ user: USER }).lean();
    expect(plan?.entries[0]?.servings ?? null).toBeNull();
  });

  it('rejects a servings count outside the allowed range', async () => {
    const entryId = await seedEntry();
    for (const servings of [0, -1, 2.5, LIMITS.servings + 1]) {
      const res = await api()
        .patch(`/api/meal-plan/entries/${entryId}`)
        .set(auth)
        .send({ servings });
      expectError(res, 400, 'bad_request');
    }
  });

  it('404s for another user’s entry, without touching it', async () => {
    const entryId = await seedEntry();
    const res = await api()
      .patch(`/api/meal-plan/entries/${entryId}`)
      .set(otherAuth)
      .send({ servings: 9 });

    expectError(res, 404, 'not_found');

    const plan = await MealPlan.findOne({ user: USER }).lean();
    expect(plan?.entries[0]?.servings).toBe(2);
    // …and no plan was conjured for the other user.
    expect(await MealPlan.countDocuments({ user: OTHER })).toBe(0);
  });

  it('404s for an unknown entry and 400s for a malformed id', async () => {
    await seedEntry();
    expectError(
      await api()
        .patch(`/api/meal-plan/entries/${new mongoose.Types.ObjectId().toString()}`)
        .set(auth)
        .send({ servings: 4 }),
      404,
      'not_found',
    );
    expectError(
      await api().patch('/api/meal-plan/entries/nonsense').set(auth).send({ servings: 4 }),
      400,
      'bad_request',
    );
  });
});

// === Deleting ================================================================

describe('DELETE /api/meal-plan/entries/:entryId', () => {
  it('removes the entry and returns the remaining week', async () => {
    const first = await addEntry(recipeId, { date: MONDAY, mealType: 'lunch' });
    const second = await addEntry(recipeId, { date: TUESDAY, mealType: 'dinner' });
    const entryId = second.body.entries.find((e: { date: string }) => e.date === TUESDAY)._id;

    const res = await api().delete(`/api/meal-plan/entries/${entryId}`).set(auth);

    expect(res.status).toBe(200);
    expect(res.body.weekStart).toBe(MONDAY);
    expect(res.body.entries).toHaveLength(1);
    expect(res.body.entries[0]._id).toBe(first.body.entries[0]._id);
  });

  it('404s for an unknown entry id', async () => {
    await addEntry(recipeId);
    const res = await api()
      .delete(`/api/meal-plan/entries/${new mongoose.Types.ObjectId().toString()}`)
      .set(auth);
    expectError(res, 404, 'not_found');
  });

  it('400s for a malformed entry id', async () => {
    const res = await api().delete('/api/meal-plan/entries/not-an-id').set(auth);
    expectError(res, 400, 'bad_request');
  });

  it('404s for another user’s entry and leaves it in place', async () => {
    const created = await addEntry(recipeId);
    const entryId = created.body.entries[0]._id;

    expectError(await api().delete(`/api/meal-plan/entries/${entryId}`).set(otherAuth), 404, 'not_found');

    const plan = await MealPlan.findOne({ user: USER }).lean();
    expect(plan?.entries).toHaveLength(1);
  });
});

// === Deleted recipes and isolation ==========================================

describe('a recipe deleted after being planned', () => {
  it('is filtered out rather than returned as null', async () => {
    const keeper = await createRecipe({ title: 'Keeper' });
    await addEntry(recipeId, { date: MONDAY, mealType: 'lunch' });
    await addEntry(String(keeper._id), { date: TUESDAY, mealType: 'dinner' });

    await Recipe.deleteOne({ _id: recipeId });

    const res = await api().get('/api/meal-plan').query({ week: MONDAY }).set(auth);

    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(1);
    expect(res.body.entries[0].recipe.title).toBe('Keeper');
    expect(res.body.entries.every((e: { recipe: unknown }) => e.recipe != null)).toBe(true);

    // The orphan is still stored — it is dropped on read, not on delete.
    const plan = await MealPlan.findOne({ user: USER }).lean();
    expect(plan?.entries).toHaveLength(2);
  });

  it('does not break the week when every planned recipe is gone', async () => {
    await addEntry(recipeId);
    await Recipe.deleteMany({});

    const res = await api().get('/api/meal-plan').query({ week: MONDAY }).set(auth);
    expect(res.status).toBe(200);
    expect(res.body.entries).toEqual([]);
    expect(res.body.days).toHaveLength(7);
  });
});

describe('isolation between users', () => {
  it('never shows one user’s plan to another', async () => {
    await addEntry(recipeId, { date: TUESDAY });

    const mine = await api().get('/api/meal-plan').query({ week: MONDAY }).set(auth);
    const theirs = await api().get('/api/meal-plan').query({ week: MONDAY }).set(otherAuth);

    expect(mine.body.entries).toHaveLength(1);
    expect(theirs.body.entries).toEqual([]);
    expect(theirs.body.weekStart).toBe(MONDAY);
    expectNoEmailLeak(theirs.body);
  });

  it('keeps two users’ plans for the same week in separate documents', async () => {
    await addEntry(recipeId, {}, auth);
    await addEntry(recipeId, {}, otherAuth);

    expect(await MealPlan.countDocuments({ weekStart: MONDAY })).toBe(2);
  });
});

// === Shopping list generation ===============================================

describe('POST /api/meal-plan/shopping-list', () => {
  /** A recipe whose amounts are unambiguous to scale. */
  async function scalableRecipe(servings: number | null, title = 'Scalable') {
    return createRecipe({
      title,
      servings,
      ingredients: [
        { amount: '200 g', name: 'rice' },
        { amount: '2', name: 'onions' },
      ],
    });
  }

  const amountOf = (items: { name: string; amount: string }[], name: string) =>
    items.find((item) => item.name === name)?.amount;

  it('scales quantities against the recipe’s own servings', async () => {
    const recipe = await scalableRecipe(4);
    await addEntry(String(recipe._id), { date: TUESDAY, servings: 8 });

    const res = await api().post('/api/meal-plan/shopping-list').query({ week: MONDAY }).set(auth);

    expect(res.status).toBe(200);
    expect(res.body.meals).toBe(1);
    expect(res.body.recipes).toBe(1);
    expect(res.body.dropped).toBe(0);
    expect(amountOf(res.body.items, 'rice')).toBe('400 g');
    expect(amountOf(res.body.items, 'onions')).toBe('4');
  });

  it('scales down as well as up', async () => {
    const recipe = await scalableRecipe(4);
    await addEntry(String(recipe._id), { date: TUESDAY, servings: 2 });

    const res = await api().post('/api/meal-plan/shopping-list').query({ week: MONDAY }).set(auth);
    expect(amountOf(res.body.items, 'rice')).toBe('100 g');
  });

  it('uses the recipe as written when servings is null', async () => {
    const recipe = await scalableRecipe(4);
    await addEntry(String(recipe._id), { date: TUESDAY, servings: null });

    const res = await api().post('/api/meal-plan/shopping-list').query({ week: MONDAY }).set(auth);
    expect(amountOf(res.body.items, 'rice')).toBe('200 g');
    expect(amountOf(res.body.items, 'onions')).toBe('2');
  });

  it('does not scale a recipe that states no servings, rather than dividing by zero', async () => {
    const recipe = await scalableRecipe(null);
    await addEntry(String(recipe._id), { date: TUESDAY, servings: 10 });

    const res = await api().post('/api/meal-plan/shopping-list').query({ week: MONDAY }).set(auth);
    expect(amountOf(res.body.items, 'rice')).toBe('200 g');
    expect(amountOf(res.body.items, 'onions')).toBe('2');
    for (const item of res.body.items) {
      expect(item.amount).not.toMatch(/Infinity|NaN/);
    }
  });

  it('leaves amounts it cannot parse completely untouched', async () => {
    const recipe = await createRecipe({
      title: 'Vague',
      servings: 2,
      ingredients: [{ amount: 'a pinch', name: 'saffron' }],
    });
    await addEntry(String(recipe._id), { date: TUESDAY, servings: 4 });

    const res = await api().post('/api/meal-plan/shopping-list').query({ week: MONDAY }).set(auth);
    expect(amountOf(res.body.items, 'saffron')).toBe('a pinch');
  });

  it('does not duplicate items when run twice for the same week', async () => {
    const recipe = await scalableRecipe(4);
    await addEntry(String(recipe._id), { date: TUESDAY, servings: 8 });

    const first = await api().post('/api/meal-plan/shopping-list').query({ week: MONDAY }).set(auth);
    const second = await api().post('/api/meal-plan/shopping-list').query({ week: MONDAY }).set(auth);

    expect(second.status).toBe(200);
    expect(second.body.items).toHaveLength(first.body.items.length);
    expect(second.body.recipes).toBe(1);
    expect(second.body.dropped).toBe(0);
    // Re-running re-states the same total rather than compounding it.
    expect(amountOf(second.body.items, 'rice')).toBe('400 g');
    expect(second.body.items.map((i: { id: string }) => i.id)).toEqual(
      first.body.items.map((i: { id: string }) => i.id),
    );
    expect(new Set(second.body.items.map((i: { id: string }) => i.id)).size).toBe(
      second.body.items.length,
    );

    const stored = await ShoppingList.findOne({ user: USER }).lean();
    expect(stored?.items).toHaveLength(first.body.items.length);
  });

  it('contributes one line for a recipe planned on two days', async () => {
    const recipe = await scalableRecipe(4);
    await addEntry(String(recipe._id), { date: MONDAY, mealType: 'lunch' });
    await addEntry(String(recipe._id), { date: TUESDAY, mealType: 'dinner' });

    const res = await api().post('/api/meal-plan/shopping-list').query({ week: MONDAY }).set(auth);

    expect(res.body.meals).toBe(2);
    expect(res.body.recipes).toBe(1);
    expect(res.body.items).toHaveLength(2); // two ingredients, not four
    expect(res.body.items.map((i: { name: string }) => i.name).sort()).toEqual(['onions', 'rice']);
    // One line, but it shops for both meals: the recipe as written, twice.
    expect(amountOf(res.body.items, 'rice')).toBe('400 g');
  });

  // Was FINDINGS-WAVE6.md #1, now fixed: the scale factors are summed per
  // recipe before any line is built, so one line carries both meals.
  it('sums the quantities when the same recipe is planned at two servings counts', async () => {
    const recipe = await scalableRecipe(4);
    await addEntry(String(recipe._id), { date: MONDAY, mealType: 'lunch', servings: 4 });
    await addEntry(String(recipe._id), { date: TUESDAY, mealType: 'dinner', servings: 8 });

    const res = await api().post('/api/meal-plan/shopping-list').query({ week: MONDAY }).set(auth);

    expect(res.status).toBe(200);
    expect(res.body.meals).toBe(2);
    expect(res.body.recipes).toBe(1);
    expect(res.body.items).toHaveLength(2); // still one line per ingredient
    expect(amountOf(res.body.items, 'rice')).toBe('600 g'); // 200 g + 400 g
    expect(amountOf(res.body.items, 'onions')).toBe('6'); // 2 + 4
  });

  it('adds a third helping rather than merely taking the largest', async () => {
    // Three meals, three different factors: 1 + 2 + ½ = 3.5. Anything that
    // takes a maximum, a last value or a pairwise merge lands on 2 or 400 g.
    const recipe = await scalableRecipe(4);
    await addEntry(String(recipe._id), { date: MONDAY, mealType: 'lunch', servings: 4 });
    await addEntry(String(recipe._id), { date: TUESDAY, mealType: 'dinner', servings: 8 });
    await addEntry(String(recipe._id), { date: SUNDAY, mealType: 'breakfast', servings: 2 });

    const res = await api().post('/api/meal-plan/shopping-list').query({ week: MONDAY }).set(auth);

    expect(res.body.meals).toBe(3);
    expect(res.body.recipes).toBe(1);
    expect(res.body.items).toHaveLength(2);
    expect(amountOf(res.body.items, 'rice')).toBe('700 g'); // 200 + 400 + 100
    expect(amountOf(res.body.items, 'onions')).toBe('7'); // 2 + 4 + 1
  });

  it('counts an unscalable recipe once per meal instead of dividing by zero', async () => {
    // No stated yield, so each meal contributes a factor of 1 — three helpings
    // of a recipe nobody scaled is still three helpings.
    const recipe = await scalableRecipe(null);
    await addEntry(String(recipe._id), { date: MONDAY, mealType: 'lunch' });
    await addEntry(String(recipe._id), { date: TUESDAY, mealType: 'dinner', servings: 10 });

    const res = await api().post('/api/meal-plan/shopping-list').query({ week: MONDAY }).set(auth);
    expect(res.body.recipes).toBe(1);
    expect(amountOf(res.body.items, 'rice')).toBe('400 g');
    for (const item of res.body.items) expect(item.amount).not.toMatch(/Infinity|NaN/);
  });

  // Was FINDINGS-WAVE6.md #2, now fixed: over the cap, mergeItems gives up
  // ticked items first and never the ones just added, and says how many went.
  it('does not silently discard the week’s ingredients when the list is full', async () => {
    const full = Array.from({ length: LIMITS.shoppingItems }, (_, index) => ({
      id: `manual-${index}`,
      name: `thing ${index}`,
      addedAt: 1_000 + index,
    }));
    await api().put('/api/shopping-list').set(auth).send({ items: full }).expect(200);

    const recipe = await scalableRecipe(4);
    await addEntry(String(recipe._id), { date: TUESDAY });

    const res = await api().post('/api/meal-plan/shopping-list').query({ week: MONDAY }).set(auth);

    expect(res.status).toBe(200);
    // The ingredients make it in…
    const names = res.body.items.map((i: { name: string }) => i.name);
    expect(names).toContain('rice');
    expect(names).toContain('onions');
    expect(res.body.items).toHaveLength(LIMITS.shoppingItems);
    // …the oldest manual items are what gave way…
    expect(names).not.toContain('thing 0');
    expect(names).not.toContain('thing 1');
    expect(names).toContain(`thing ${LIMITS.shoppingItems - 1}`);
    // …and the caller is told, rather than being shown a bare success.
    expect(res.body.dropped).toBe(2);
  });

  it('sacrifices ticked items before anything still needed when the list is full', async () => {
    // Twenty of the stored items are already in the basket. Two lines have to
    // go, and they come out of those twenty — nothing still needed is lost.
    const full = Array.from({ length: LIMITS.shoppingItems }, (_, index) => ({
      id: `manual-${index}`,
      name: `thing ${index}`,
      addedAt: 1_000 + index,
      checked: index < 20,
    }));
    await api().put('/api/shopping-list').set(auth).send({ items: full }).expect(200);

    const recipe = await scalableRecipe(4);
    await addEntry(String(recipe._id), { date: TUESDAY });

    const res = await api().post('/api/meal-plan/shopping-list').query({ week: MONDAY }).set(auth);

    const names = res.body.items.map((i: { name: string }) => i.name);
    expect(res.body.items).toHaveLength(LIMITS.shoppingItems);
    expect(res.body.dropped).toBe(2);
    expect(names).toContain('rice');
    expect(names).toContain('onions');
    // The two oldest ticked items went; every unticked one stayed.
    expect(names).not.toContain('thing 0');
    expect(names).not.toContain('thing 1');
    expect(names).toContain('thing 2');
    for (let index = 20; index < LIMITS.shoppingItems; index += 1) {
      expect(names, `thing ${index}`).toContain(`thing ${index}`);
    }
  });

  /**
   * Regression for FINDINGS-WAVE6 #3, which was introduced by the fix for #2.
   * With the unticked items alone filling the cap, `room` is 0 — and
   * `checked.slice(-0)` is `checked.slice(0)`, the whole array. Every ticked
   * item was kept, the cap was breached by exactly that many, and `dropped`
   * reported a truncation that had not happened.
   */
  it('still respects the cap when the unticked items alone fill it', async () => {
    const full = Array.from({ length: LIMITS.shoppingItems }, (_, index) => ({
      id: `manual-${index}`,
      name: `thing ${index}`,
      addedAt: 1_000 + index,
      checked: index < 2,
    }));
    await api().put('/api/shopping-list').set(auth).send({ items: full }).expect(200);

    const recipe = await scalableRecipe(4);
    await addEntry(String(recipe._id), { date: TUESDAY });

    const res = await api().post('/api/meal-plan/shopping-list').query({ week: MONDAY }).set(auth);

    expect(res.body.items.length).toBeLessThanOrEqual(LIMITS.shoppingItems);
    expect(res.body.items.map((i: { name: string }) => i.name)).toContain('rice');
    // Whatever `dropped` says must be what actually happened.
    expect(res.body.dropped).toBe(LIMITS.shoppingItems + 2 - res.body.items.length);
  });

  /**
   * The invariant, rather than a number.
   *
   * Both cap bugs reported a `dropped` count that disagreed with the array it
   * described — the first claimed nothing was added when nothing was, the
   * second claimed a truncation that never happened. A fixed expected number
   * would have passed for one mix and missed the other; this holds for every
   * mix, which is what makes it worth asserting.
   */
  it.each([
    ['nothing ticked', 0],
    ['a few ticked', 5],
    ['everything ticked', LIMITS.shoppingItems],
  ])('reports a dropped count that matches what actually survived (%s)', async (_label, tickedCount) => {
    const full = Array.from({ length: LIMITS.shoppingItems }, (_, index) => ({
      id: `manual-${index}`,
      name: `thing ${index}`,
      addedAt: 1_000 + index,
      checked: index < tickedCount,
    }));
    await api().put('/api/shopping-list').set(auth).send({ items: full }).expect(200);

    const recipe = await scalableRecipe(4);
    await addEntry(String(recipe._id), { date: TUESDAY });

    const res = await api().post('/api/meal-plan/shopping-list').query({ week: MONDAY }).set(auth);

    // Two ingredients on the seeded recipe, neither already present.
    const uniqueInputs = LIMITS.shoppingItems + res.body.added;

    expect(res.body.items.length).toBeLessThanOrEqual(LIMITS.shoppingItems);
    expect(res.body.dropped).toBe(uniqueInputs - res.body.items.length);
    // And whatever was sacrificed, it was never the thing just asked for.
    expect(res.body.items.map((i: { name: string }) => i.name)).toContain('rice');
  });

  it('keeps two different recipes apart', async () => {
    const one = await scalableRecipe(4, 'One');
    const two = await scalableRecipe(4, 'Two');
    await addEntry(String(one._id), { date: MONDAY, mealType: 'lunch' });
    await addEntry(String(two._id), { date: MONDAY, mealType: 'dinner' });

    const res = await api().post('/api/meal-plan/shopping-list').query({ week: MONDAY }).set(auth);
    expect(res.body.items).toHaveLength(4);
    expect(res.body.recipes).toBe(2);
    expect(res.body.meals).toBe(2);
    expect(new Set(res.body.items.map((i: { recipeTitle: string }) => i.recipeTitle))).toEqual(
      new Set(['One', 'Two']),
    );
  });

  it('merges with an existing manual list rather than replacing it', async () => {
    await api()
      .put('/api/shopping-list')
      .set(auth)
      .send({ items: [{ id: 'manual-1', name: 'washing-up liquid', amount: '1', addedAt: 1 }] })
      .expect(200);

    const recipe = await scalableRecipe(4);
    await addEntry(String(recipe._id), { date: TUESDAY });

    const res = await api().post('/api/meal-plan/shopping-list').query({ week: MONDAY }).set(auth);

    expect(res.status).toBe(200);
    const names = res.body.items.map((i: { name: string }) => i.name);
    expect(names).toContain('washing-up liquid');
    expect(names).toContain('rice');
    expect(res.body.items).toHaveLength(3);
    expect(res.body.added).toBe(2); // lines written, not contributions counted
    expect(res.body.dropped).toBe(0);
  });

  it('preserves the checked state of an item it regenerates', async () => {
    const recipe = await scalableRecipe(4);
    await addEntry(String(recipe._id), { date: TUESDAY });
    const first = await api().post('/api/meal-plan/shopping-list').query({ week: MONDAY }).set(auth);

    const ticked = first.body.items.map((item: Record<string, unknown>) => ({
      ...item,
      checked: true,
    }));
    await api().put('/api/shopping-list').set(auth).send({ items: ticked }).expect(200);

    const again = await api().post('/api/meal-plan/shopping-list').query({ week: MONDAY }).set(auth);
    expect(again.body.items.every((i: { checked: boolean }) => i.checked)).toBe(true);
  });

  it('only takes the requested week', async () => {
    const thisWeek = await scalableRecipe(4, 'This week');
    const nextWeek = await createRecipe({
      title: 'Next week',
      servings: 4,
      ingredients: [{ amount: '1', name: 'lamb shank' }],
    });
    await addEntry(String(thisWeek._id), { date: TUESDAY });
    await addEntry(String(nextWeek._id), { date: '2026-07-29' });

    const res = await api().post('/api/meal-plan/shopping-list').query({ week: MONDAY }).set(auth);
    expect(res.body.meals).toBe(1);
    expect(res.body.recipes).toBe(1);
    expect(res.body.items.map((i: { name: string }) => i.name)).not.toContain('lamb shank');
  });

  it('defaults to the current week when no week is given', async () => {
    const recipe = await scalableRecipe(4);
    await addEntry(String(recipe._id), { date: currentMonday() });

    const res = await api().post('/api/meal-plan/shopping-list').set(auth);
    expect(res.status).toBe(200);
    expect(res.body.meals).toBe(1);
    expect(res.body.recipes).toBe(1);
  });

  it('400s with a helpful message for an empty week', async () => {
    const res = await api().post('/api/meal-plan/shopping-list').query({ week: MONDAY }).set(auth);
    expectError(res, 400, 'bad_request');
    expect(res.body.error.message).toMatch(/nothing planned/i);
    expect(await ShoppingList.countDocuments()).toBe(0);
  });

  it('400s for a malformed week', async () => {
    const res = await api()
      .post('/api/meal-plan/shopping-list')
      .query({ week: '2026-02-30' })
      .set(auth);
    expectError(res, 400, 'bad_request');
  });

  it('skips an entry whose recipe has been deleted', async () => {
    const gone = await scalableRecipe(4, 'Gone');
    const kept = await createRecipe({
      title: 'Kept',
      servings: 4,
      ingredients: [{ amount: '3', name: 'eggs' }],
    });
    await addEntry(String(gone._id), { date: MONDAY, mealType: 'lunch' });
    await addEntry(String(kept._id), { date: MONDAY, mealType: 'dinner' });
    await Recipe.deleteOne({ _id: gone._id });

    const res = await api().post('/api/meal-plan/shopping-list').query({ week: MONDAY }).set(auth);
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: { name: string }) => i.name)).toEqual(['eggs']);
    // The deleted recipe contributes no line and is not counted.
    expect(res.body.recipes).toBe(1);
    expect(res.body.meals).toBe(2);
  });

  it('never writes into another user’s list, and leaks no email', async () => {
    const recipe = await scalableRecipe(4);
    await addEntry(String(recipe._id), { date: TUESDAY });

    const res = await api().post('/api/meal-plan/shopping-list').query({ week: MONDAY }).set(auth);
    expectNoEmailLeak(res.body);

    const theirs = await api().get('/api/shopping-list').set(otherAuth);
    expect(theirs.body.items).toEqual([]);
  });
});
