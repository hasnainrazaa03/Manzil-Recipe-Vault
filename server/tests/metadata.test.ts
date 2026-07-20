import { describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { Recipe } from '../src/models/Recipe.js';
import { api, authHeader, createRecipe, expectNoEmailLeak, recipePayload } from './helpers.js';

/**
 * The cooking-metadata surface: five optional fields, one derived field, the
 * list filters built on them, and the two endpoints they added.
 *
 * The property under test throughout is that `null` means "not stated" and is
 * never conflated with zero — a recipe whose timing nobody entered must not be
 * recommended as the fastest thing on the site.
 */

const USER_A = 'user-a';
const USER_B = 'user-b';

/** Creates a recipe through the API and returns the parsed body. */
async function postRecipe(overrides: Record<string, unknown> = {}, uid = USER_A) {
  return api().post('/api/recipes').set(authHeader(uid)).send(recipePayload(overrides));
}

describe('recipe metadata — field validation', () => {
  it('accepts all five fields and persists them', async () => {
    const res = await postRecipe({
      servings: 4,
      prepMinutes: 15,
      cookMinutes: 25,
      difficulty: 'medium',
      cuisine: 'Thai',
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      servings: 4,
      prepMinutes: 15,
      cookMinutes: 25,
      difficulty: 'medium',
      cuisine: 'Thai',
    });

    const stored = await Recipe.findById(res.body._id).lean();
    expect(stored).toMatchObject({
      servings: 4,
      prepMinutes: 15,
      cookMinutes: 25,
      difficulty: 'medium',
      cuisine: 'Thai',
    });
  });

  it('accepts a recipe with none of them — the shape every pre-existing row has', async () => {
    const res = await postRecipe();

    expect(res.status).toBe(201);
    expect(res.body.servings).toBeNull();
    expect(res.body.prepMinutes).toBeNull();
    expect(res.body.cookMinutes).toBeNull();
    expect(res.body.difficulty).toBeNull();
    // A string field, so its "unset" value is the empty string rather than null.
    expect(res.body.cuisine).toBe('');
  });

  it.each([
    ['servings below the minimum', { servings: 0 }],
    ['servings above the maximum', { servings: 101 }],
    ['negative prep minutes', { prepMinutes: -1 }],
    ['cook minutes over a day', { cookMinutes: 1441 }],
    ['a fractional serving count', { servings: 2.5 }],
    ['an unknown difficulty', { difficulty: 'impossible' }],
  ])('rejects %s', async (_label, invalid) => {
    const res = await postRecipe(invalid);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('bad_request');
    expect(await Recipe.countDocuments()).toBe(0);
  });

  it('accepts the boundary values', async () => {
    const res = await postRecipe({
      servings: 1,
      prepMinutes: 0,
      cookMinutes: 1440,
      cuisine: 'x'.repeat(40),
    });

    expect(res.status).toBe(201);
    expect(res.body.servings).toBe(1);
    expect(res.body.prepMinutes).toBe(0);
    expect(res.body.cookMinutes).toBe(1440);
  });

  it.each([
    ['an empty string', ''],
    ['null', null],
  ])('treats %s as "not stated" for difficulty', async (_label, cleared) => {
    const res = await postRecipe({ difficulty: cleared });

    expect(res.status).toBe(201);
    expect(res.body.difficulty).toBeNull();
  });

  // Regression for FINDINGS #7: `optionalCount` used to put `z.coerce.number()`
  // first in its union, and `Number('')` / `Number(null)` are both `0`, so a
  // cleared numeric field never reached the `null` branch.
  it.each([
    ['an empty string', ''],
    ['null', null],
  ])('treats %s as "not stated" for the optional numbers', async (_label, cleared) => {
    const res = await postRecipe({
      servings: cleared,
      prepMinutes: cleared,
      cookMinutes: cleared,
    });

    expect(res.status).toBe(201);
    expect(res.body.servings).toBeNull();
    expect(res.body.prepMinutes).toBeNull();
    expect(res.body.cookMinutes).toBeNull();
    expect(res.body.totalMinutes).toBeNull();
  });

  it('rejects a cuisine over 40 characters', async () => {
    const res = await postRecipe({ cuisine: 'x'.repeat(41) });

    expect(res.status).toBe(400);
    expect((res.body.error.details as { path: string }[]).some((d) => d.path === 'cuisine')).toBe(true);
  });

  it('strips markup from cuisine', async () => {
    const res = await postRecipe({ cuisine: '<script>x</script>Thai' });

    expect(res.status).toBe(201);
    expect(res.body.cuisine).not.toContain('<');
    expect(res.body.cuisine).not.toContain('script');

    const stored = await Recipe.findById(res.body._id).lean();
    expect(stored!.cuisine).not.toContain('<');
    expect(stored!.cuisine).toContain('Thai');
  });

  it('a client cannot set totalMinutes on create — it is derived, not writable', async () => {
    const res = await postRecipe({ prepMinutes: 5, cookMinutes: 5, totalMinutes: 1 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('bad_request');
    expect(await Recipe.countDocuments()).toBe(0);
  });

  it('a client cannot set totalMinutes on update either', async () => {
    const recipe = await createRecipe({ author: USER_A, prepMinutes: 10, cookMinutes: 10 });

    const res = await api()
      .put(`/api/recipes/${recipe.id}`)
      .set(authHeader(USER_A))
      .send({ title: 'Renamed', totalMinutes: 1 });

    expect(res.status).toBe(400);

    const after = await Recipe.findById(recipe.id).lean();
    expect(after!.totalMinutes).toBe(20);
    expect(after!.title).not.toBe('Renamed');
  });
});

describe('recipe metadata — derived totalMinutes', () => {
  it('is the sum of prep and cook', async () => {
    const res = await postRecipe({ prepMinutes: 10, cookMinutes: 20 });

    expect(res.status).toBe(201);
    expect(res.body.totalMinutes).toBe(30);
  });

  it('equals prep alone when only prep is stated', async () => {
    const res = await postRecipe({ prepMinutes: 10 });

    expect(res.status).toBe(201);
    expect(res.body.totalMinutes).toBe(10);
    expect(res.body.cookMinutes).toBeNull();
  });

  it('equals cook alone when only cook is stated', async () => {
    const res = await postRecipe({ cookMinutes: 45 });

    expect(res.status).toBe(201);
    expect(res.body.totalMinutes).toBe(45);
    expect(res.body.prepMinutes).toBeNull();
  });

  it('is null — not 0 — when neither is stated', async () => {
    const res = await postRecipe();

    expect(res.status).toBe(201);
    expect(res.body.totalMinutes).toBeNull();
    // The distinction is what keeps untimed recipes out of "quickest first".
    expect(res.body.totalMinutes).not.toBe(0);

    const stored = await Recipe.findById(res.body._id).lean();
    expect(stored!.totalMinutes).toBeNull();
    expect(stored!.totalMinutes).not.toBe(0);
  });

  it('is recomputed when prep changes', async () => {
    const created = await postRecipe({ prepMinutes: 10, cookMinutes: 20 });
    expect(created.body.totalMinutes).toBe(30);

    const res = await api()
      .put(`/api/recipes/${created.body._id}`)
      .set(authHeader(USER_A))
      .send({ prepMinutes: 40 });

    expect(res.status).toBe(200);
    expect(res.body.totalMinutes).toBe(60);

    const stored = await Recipe.findById(created.body._id).lean();
    expect(stored!.totalMinutes).toBe(60);
  });

  it('is recomputed when cook changes', async () => {
    const created = await postRecipe({ prepMinutes: 10, cookMinutes: 20 });

    const res = await api()
      .put(`/api/recipes/${created.body._id}`)
      .set(authHeader(USER_A))
      .send({ cookMinutes: 0 });

    expect(res.status).toBe(200);
    expect(res.body.totalMinutes).toBe(10);
  });

  // Regression for FINDINGS #7. Collapsing null to 0 here was the damaging
  // case: a cleared recipe would top `?sort=quickest` and match every
  // `?maxMinutes`, which is exactly what the `$ne: null` filter guards against.
  it('goes back to null when both inputs are cleared', async () => {
    const created = await postRecipe({ prepMinutes: 10, cookMinutes: 20 });

    const res = await api()
      .put(`/api/recipes/${created.body._id}`)
      .set(authHeader(USER_A))
      .send({ prepMinutes: null, cookMinutes: null });

    expect(res.status).toBe(200);
    expect(res.body.totalMinutes).toBeNull();

    const stored = await Recipe.findById(created.body._id).lean();
    expect(stored!.totalMinutes).toBeNull();
  });

  it('the model recomputes the total for a direct write too', async () => {
    const recipe = await createRecipe({ prepMinutes: 5, cookMinutes: 7 });
    expect(recipe.totalMinutes).toBe(12);

    recipe.cookMinutes = null;
    await recipe.save();
    expect(recipe.totalMinutes).toBe(5);

    recipe.prepMinutes = null;
    await recipe.save();
    expect(recipe.totalMinutes).toBeNull();
  });
});

describe('GET /api/recipes — metadata filters and sorting', () => {
  const titles = (body: { items: { title: string }[] }) => body.items.map((item) => item.title);

  it('?difficulty filters to that difficulty only', async () => {
    await createRecipe({ title: 'Easy one', difficulty: 'easy' });
    await createRecipe({ title: 'Hard one', difficulty: 'hard' });
    await createRecipe({ title: 'Unstated' });

    const res = await api().get('/api/recipes?difficulty=easy');

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(titles(res.body)).toEqual(['Easy one']);
  });

  it('?difficulty rejects a value outside the enum', async () => {
    const res = await api().get('/api/recipes?difficulty=impossible');

    expect(res.status).toBe(400);
  });

  it('?cuisine matches case-insensitively', async () => {
    await createRecipe({ title: 'Pad thai', cuisine: 'Thai' });
    await createRecipe({ title: 'Ragu', cuisine: 'Italian' });

    const res = await api().get('/api/recipes?cuisine=thai');

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(titles(res.body)).toEqual(['Pad thai']);
  });

  it('?cuisine is an anchored exact match, not a prefix match', async () => {
    await createRecipe({ title: 'Not this one', cuisine: 'Thailand' });

    const res = await api().get('/api/recipes?cuisine=thai');

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.items).toEqual([]);
  });

  it('?cuisine treats regex metacharacters literally', async () => {
    await createRecipe({ title: 'Thai', cuisine: 'Thai' });

    const res = await api().get('/api/recipes?cuisine=.%2A');

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
  });

  it('?maxMinutes includes an equal total, excludes a longer one, and excludes untimed recipes', async () => {
    await createRecipe({ title: 'Half hour', prepMinutes: 10, cookMinutes: 20 });
    await createRecipe({ title: 'Three quarters', prepMinutes: 15, cookMinutes: 30 });
    await createRecipe({ title: 'Untimed' });

    const res = await api().get('/api/recipes?maxMinutes=30');

    expect(res.status).toBe(200);
    expect(titles(res.body)).toEqual(['Half hour']);
    // Deliberate: an unstated time is not evidence of a fast recipe.
    expect(titles(res.body)).not.toContain('Untimed');
    expect(res.body.total).toBe(1);
  });

  it('?sort=quickest orders ascending by total and drops untimed recipes entirely', async () => {
    await createRecipe({ title: 'Slow', prepMinutes: 30, cookMinutes: 60 });
    await createRecipe({ title: 'Fast', prepMinutes: 5, cookMinutes: 5 });
    await createRecipe({ title: 'Medium', prepMinutes: 10, cookMinutes: 20 });
    await createRecipe({ title: 'Untimed' });

    const res = await api().get('/api/recipes?sort=quickest');

    expect(res.status).toBe(200);
    // Mongo sorts null ahead of every number ascending, so an untimed recipe
    // would otherwise head the list.
    expect(titles(res.body)).toEqual(['Fast', 'Medium', 'Slow']);
    expect(res.body.total).toBe(3);
  });

  it('?sort=quickest keeps a zero-minute recipe, which is a stated time', async () => {
    await createRecipe({ title: 'Instant', prepMinutes: 0, cookMinutes: 0 });
    await createRecipe({ title: 'Untimed' });

    const res = await api().get('/api/recipes?sort=quickest');

    expect(res.status).toBe(200);
    expect(titles(res.body)).toEqual(['Instant']);
  });

  it('metadata filters compose with search and tags', async () => {
    await createRecipe({
      title: 'Pad thai noodles',
      tags: ['dinner'],
      difficulty: 'easy',
      cuisine: 'Thai',
      prepMinutes: 10,
      cookMinutes: 10,
    });
    // Same search term and tag, but too slow.
    await createRecipe({
      title: 'Pad thai slow braise',
      tags: ['dinner'],
      difficulty: 'easy',
      cuisine: 'Thai',
      prepMinutes: 30,
      cookMinutes: 60,
    });
    // Fast and easy, but the wrong tag and search term.
    await createRecipe({
      title: 'Toast',
      tags: ['breakfast'],
      difficulty: 'easy',
      cuisine: 'Thai',
      prepMinutes: 1,
      cookMinutes: 2,
    });
    // Everything matches except the difficulty.
    await createRecipe({
      title: 'Pad thai for experts',
      tags: ['dinner'],
      difficulty: 'hard',
      cuisine: 'Thai',
      prepMinutes: 5,
      cookMinutes: 5,
    });

    const res = await api().get(
      '/api/recipes?search=pad%20thai&tag=dinner&difficulty=easy&cuisine=thai&maxMinutes=30',
    );

    expect(res.status).toBe(200);
    expect(titles(res.body)).toEqual(['Pad thai noodles']);
    expect(res.body.total).toBe(1);
  });

  it('metadata fields travel with every list item', async () => {
    await createRecipe({
      difficulty: 'easy',
      cuisine: 'Thai',
      servings: 2,
      prepMinutes: 5,
      cookMinutes: 5,
    });

    const res = await api().get('/api/recipes');

    expect(res.status).toBe(200);
    expect(res.body.items[0]).toMatchObject({
      servings: 2,
      prepMinutes: 5,
      cookMinutes: 5,
      totalMinutes: 10,
      difficulty: 'easy',
      cuisine: 'Thai',
    });
  });
});

describe('GET /api/recipes/cuisines', () => {
  it('returns counts, most used first', async () => {
    await createRecipe({ cuisine: 'Thai' });
    await createRecipe({ cuisine: 'Thai' });
    await createRecipe({ cuisine: 'Italian' });

    const res = await api().get('/api/recipes/cuisines');

    expect(res.status).toBe(200);
    expect(res.body[0]).toEqual({ cuisine: 'Thai', count: 2 });
    expect(res.body).toContainEqual({ cuisine: 'Italian', count: 1 });
    const counts = (res.body as { count: number }[]).map((entry) => entry.count);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
  });

  it('excludes recipes whose cuisine is empty or absent', async () => {
    await createRecipe({ cuisine: 'Thai' });
    await createRecipe({ cuisine: '' });
    await createRecipe();
    // A row written before the field existed, so the key is missing entirely.
    await Recipe.collection.insertOne({
      title: 'Legacy',
      overview: 'From before the metadata fields',
      ingredients: [],
      instructions: '<p>x</p>',
      author: USER_B,
      tags: [],
      ratings: [],
      averageRating: 0,
      ratingCount: 0,
      comments: [],
      commentCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await api().get('/api/recipes/cuisines');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ cuisine: 'Thai', count: 1 }]);
  });

  it('returns an empty array when nothing has a cuisine', async () => {
    await createRecipe();

    const res = await api().get('/api/recipes/cuisines');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  /**
   * The write path preserves whatever casing the author typed, so grouping on
   * the raw string listed 'Thai' and 'thai' as two filters that both matched
   * the same recipes. Grouping is case-insensitive; the count is combined and
   * the first spelling encountered becomes the label.
   */
  it('folds casing variants into one entry', async () => {
    await createRecipe({ cuisine: 'Thai' });
    await createRecipe({ cuisine: 'thai' });

    const res = await api().get('/api/recipes/cuisines');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect((res.body as { cuisine: string; count: number }[])[0]).toMatchObject({ count: 2 });
    expect((res.body as { cuisine: string }[])[0].cuisine.toLowerCase()).toBe('thai');

    // And the list filter still matches both, whichever casing is asked for.
    const list = await api().get('/api/recipes?cuisine=THAI');
    expect(list.body.total).toBe(2);
  });
});

describe('GET /api/recipes/:id/related', () => {
  it('ranks a full tag overlap above a single shared tag', async () => {
    const subject = await createRecipe({ title: 'Subject', tags: ['a', 'b', 'c'] });
    await createRecipe({ title: 'One tag', tags: ['a'] });
    await createRecipe({ title: 'All three', tags: ['a', 'b', 'c'] });

    const res = await api().get(`/api/recipes/${subject.id}/related`);

    expect(res.status).toBe(200);
    const order = (res.body as { title: string }[]).map((item) => item.title);
    expect(order.indexOf('All three')).toBeLessThan(order.indexOf('One tag'));
    expect(order.indexOf('All three')).toBe(0);
  });

  it('never includes the subject recipe itself', async () => {
    const subject = await createRecipe({ title: 'Subject', tags: ['a'] });
    await createRecipe({ title: 'Other', tags: ['a'] });

    const res = await api().get(`/api/recipes/${subject.id}/related`);

    expect(res.status).toBe(200);
    expect((res.body as { _id: string }[]).map((item) => String(item._id))).not.toContain(subject.id);
  });

  it('caps the list at six', async () => {
    const subject = await createRecipe({ title: 'Subject', tags: ['a'] });
    for (let i = 0; i < 9; i += 1) {
      await createRecipe({ title: `Sibling ${i}`, tags: ['a'] });
    }

    const res = await api().get(`/api/recipes/${subject.id}/related`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(6);
    expect((res.body as { _id: string }[]).map((item) => String(item._id))).not.toContain(subject.id);
  });

  it('falls back to other recipes when the subject has no tags', async () => {
    const subject = await createRecipe({ title: 'Subject', tags: [] });
    await createRecipe({ title: 'Well rated', averageRating: 5, ratingCount: 3 });
    await createRecipe({ title: 'Less rated', averageRating: 2, ratingCount: 1 });

    const res = await api().get(`/api/recipes/${subject.id}/related`);

    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    const order = (res.body as { title: string }[]).map((item) => item.title);
    expect(order).not.toContain('Subject');
    expect(order[0]).toBe('Well rated');
  });

  it('prefers the same cuisine in the fallback', async () => {
    const subject = await createRecipe({ title: 'Subject', tags: [], cuisine: 'Thai' });
    await createRecipe({ title: 'Also Thai', cuisine: 'Thai', averageRating: 1, ratingCount: 1 });
    await createRecipe({ title: 'Italian', cuisine: 'Italian', averageRating: 5, ratingCount: 9 });

    const res = await api().get(`/api/recipes/${subject.id}/related`);

    expect(res.status).toBe(200);
    const order = (res.body as { title: string }[]).map((item) => item.title);
    expect(order).toEqual(['Also Thai']);
  });

  it('tops a thin tag match up from the fallback rather than returning a short list', async () => {
    const subject = await createRecipe({ title: 'Subject', tags: ['a'] });
    await createRecipe({ title: 'Tagged', tags: ['a'] });
    for (let i = 0; i < 6; i += 1) {
      await createRecipe({ title: `Untagged ${i}`, tags: [] });
    }

    const res = await api().get(`/api/recipes/${subject.id}/related`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(6);
    const order = (res.body as { title: string }[]).map((item) => item.title);
    expect(order[0]).toBe('Tagged');
    // No duplicates between the tag match and the filler.
    expect(new Set(order).size).toBe(order.length);
  });

  it('returns an empty array when there is nothing else to show', async () => {
    const subject = await createRecipe({ tags: ['a'] });

    const res = await api().get(`/api/recipes/${subject.id}/related`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('is 404 for an unknown id and 400 for a malformed one', async () => {
    const unknown = await api().get(`/api/recipes/${new mongoose.Types.ObjectId().toString()}/related`);
    const malformed = await api().get('/api/recipes/not-an-id/related');

    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('not_found');
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe('bad_request');
  });

  it('leaks no author email and omits the instructions, on both branches', async () => {
    const subject = await createRecipe({
      title: 'Subject',
      tags: ['a'],
      cuisine: 'Thai',
      author: USER_A,
      authorEmail: 'user-a@example.com',
    });
    // One match through the tag aggregation, one through the fallback query.
    await createRecipe({ title: 'Tagged', tags: ['a'], author: USER_B, authorEmail: 'user-b@example.com' });
    await createRecipe({ title: 'Filler', tags: [], cuisine: 'Thai', author: USER_B, authorEmail: 'user-b@example.com' });

    const res = await api().get(`/api/recipes/${subject.id}/related`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expectNoEmailLeak(res.body);
    for (const item of res.body as Record<string, unknown>[]) {
      expect(item).not.toHaveProperty('instructions');
      expect(item).not.toHaveProperty('authorEmail');
      expect(item).not.toHaveProperty('ratings');
      expect(item).not.toHaveProperty('comments');
    }
  });

  it('carries the metadata fields the related-recipe card renders', async () => {
    const subject = await createRecipe({ tags: ['a'] });
    await createRecipe({
      tags: ['a'],
      servings: 4,
      prepMinutes: 10,
      cookMinutes: 5,
      difficulty: 'easy',
      cuisine: 'Thai',
    });

    const res = await api().get(`/api/recipes/${subject.id}/related`);

    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({
      servings: 4,
      prepMinutes: 10,
      cookMinutes: 5,
      totalMinutes: 15,
      difficulty: 'easy',
      cuisine: 'Thai',
    });
  });
});
