import { describe, expect, it } from 'vitest';
import { Recipe } from '../src/models/Recipe.js';
import { api, authHeader, createRecipe } from './helpers.js';
import { LIMITS } from '../src/models/constants.js';

/**
 * Concurrent writes to the same recipe.
 *
 * These all used to be `findById` → mutate → `save()`. Mongoose emits a `$push`
 * for the array but a plain `$set` for any counter computed from the writer's
 * in-memory copy, so two simultaneous writers left `ratings.length` and
 * `ratingCount` permanently disagreeing — and nothing recomputed them until the
 * next write. The same pattern raised `VersionError`, which surfaced as a 500,
 * whenever anyone edited a comment while someone else commented.
 *
 * Every counter is now derived with `$size` inside the same atomic update, so
 * the array and its count cannot diverge.
 */

const OWNER = 'owner-uid';

/** Fires requests genuinely in parallel rather than merely in a loop. */
const inParallel = <T>(count: number, make: (index: number) => Promise<T>) =>
  Promise.all(Array.from({ length: count }, (_, index) => make(index)));

describe('concurrent ratings', () => {
  it('keeps ratingCount and averageRating consistent with the array', async () => {
    const recipe = await createRecipe({ author: OWNER });

    const responses = await inParallel(5, (index) =>
      api()
        .put(`/api/recipes/${recipe.id}/rating`)
        .set(authHeader(`rater-${index}`, `r${index}@example.com`))
        .send({ score: (index % 5) + 1 }),
    );

    expect(responses.every((res) => res.status === 200)).toBe(true);

    const stored = await Recipe.findById(recipe.id).lean();
    expect(stored!.ratings).toHaveLength(5);
    expect(stored!.ratingCount).toBe(5);

    const expectedAverage =
      Math.round((stored!.ratings.reduce((sum, r) => sum + r.score, 0) / 5) * 10) / 10;
    expect(stored!.averageRating).toBe(expectedAverage);
  });

  it('does not double-count a user rating twice at once', async () => {
    const recipe = await createRecipe({ author: OWNER });

    await inParallel(4, () =>
      api()
        .put(`/api/recipes/${recipe.id}/rating`)
        .set(authHeader('single-rater', 'one@example.com'))
        .send({ score: 4 }),
    );

    const stored = await Recipe.findById(recipe.id).lean();
    expect(stored!.ratings).toHaveLength(1);
    expect(stored!.ratingCount).toBe(1);
  });

  it('survives a rating change racing another user rating', async () => {
    const recipe = await createRecipe({ author: OWNER });
    await api()
      .put(`/api/recipes/${recipe.id}/rating`)
      .set(authHeader('first', 'first@example.com'))
      .send({ score: 2 });

    // Previously a VersionError, answered as a 500, losing the edit.
    const [changed, added] = await Promise.all([
      api()
        .put(`/api/recipes/${recipe.id}/rating`)
        .set(authHeader('first', 'first@example.com'))
        .send({ score: 5 }),
      api()
        .put(`/api/recipes/${recipe.id}/rating`)
        .set(authHeader('second', 'second@example.com'))
        .send({ score: 3 }),
    ]);

    expect(changed.status).toBe(200);
    expect(added.status).toBe(200);

    const stored = await Recipe.findById(recipe.id).lean();
    expect(stored!.ratings).toHaveLength(2);
    expect(stored!.ratingCount).toBe(2);
    expect(stored!.ratings.find((r) => r.userId === 'first')?.score).toBe(5);
  });

  it('recounts correctly when a rating is deleted alongside another being added', async () => {
    const recipe = await createRecipe({ author: OWNER });
    await api()
      .put(`/api/recipes/${recipe.id}/rating`)
      .set(authHeader('leaver', 'leaver@example.com'))
      .send({ score: 5 });

    await Promise.all([
      api().delete(`/api/recipes/${recipe.id}/rating`).set(authHeader('leaver', 'leaver@example.com')),
      api()
        .put(`/api/recipes/${recipe.id}/rating`)
        .set(authHeader('joiner', 'joiner@example.com'))
        .send({ score: 1 }),
    ]);

    const stored = await Recipe.findById(recipe.id).lean();
    expect(stored!.ratingCount).toBe(stored!.ratings.length);
    expect(stored!.ratings.some((r) => r.userId === 'leaver')).toBe(false);
  });
});

describe('concurrent comments', () => {
  it('keeps commentCount consistent with the array', async () => {
    const recipe = await createRecipe({ author: OWNER });

    const responses = await inParallel(6, (index) =>
      api()
        .post(`/api/recipes/${recipe.id}/comments`)
        .set(authHeader(`commenter-${index}`, `c${index}@example.com`))
        .send({ text: `comment ${index}` }),
    );

    expect(responses.every((res) => res.status === 201)).toBe(true);

    const stored = await Recipe.findById(recipe.id).lean();
    expect(stored!.comments).toHaveLength(6);
    expect(stored!.commentCount).toBe(6);
  });

  it('does not 500 when an edit races a new comment', async () => {
    const recipe = await createRecipe({ author: OWNER });
    const created = await api()
      .post(`/api/recipes/${recipe.id}/comments`)
      .set(authHeader('editor', 'editor@example.com'))
      .send({ text: 'original' });

    const [edited, added] = await Promise.all([
      api()
        .patch(`/api/recipes/${recipe.id}/comments/${created.body._id}`)
        .set(authHeader('editor', 'editor@example.com'))
        .send({ text: 'edited' }),
      api()
        .post(`/api/recipes/${recipe.id}/comments`)
        .set(authHeader('other', 'other@example.com'))
        .send({ text: 'meanwhile' }),
    ]);

    expect(edited.status).toBe(200);
    expect(added.status).toBe(201);
    expect(edited.body.text).toBe('edited');

    const stored = await Recipe.findById(recipe.id).lean();
    expect(stored!.commentCount).toBe(stored!.comments.length);
  });

  it('recounts correctly when a delete races an add', async () => {
    const recipe = await createRecipe({ author: OWNER });
    const created = await api()
      .post(`/api/recipes/${recipe.id}/comments`)
      .set(authHeader('deleter', 'deleter@example.com'))
      .send({ text: 'going away' });

    await Promise.all([
      api()
        .delete(`/api/recipes/${recipe.id}/comments/${created.body._id}`)
        .set(authHeader('deleter', 'deleter@example.com')),
      api()
        .post(`/api/recipes/${recipe.id}/comments`)
        .set(authHeader('adder', 'adder@example.com'))
        .send({ text: 'arriving' }),
    ]);

    const stored = await Recipe.findById(recipe.id).lean();
    expect(stored!.commentCount).toBe(stored!.comments.length);
    expect(stored!.comments.some((c) => c.text === 'going away')).toBe(false);
  });

  it('keeps the counter right on a legacy recipe that has no counter yet', async () => {
    // `$inc` would have been wrong here: it would set the counter to 1 on a
    // recipe that already had comments but no stored count.
    const recipe = await createRecipe({ author: OWNER });
    await Recipe.collection.updateOne(
      { _id: recipe._id },
      {
        $set: {
          comments: [
            { text: 'old one', authorId: 'x', authorEmail: 'x@example.com', createdAt: new Date() },
            { text: 'old two', authorId: 'y', authorEmail: 'y@example.com', createdAt: new Date() },
          ],
        },
        $unset: { commentCount: '' },
      },
    );

    await api()
      .post(`/api/recipes/${recipe.id}/comments`)
      .set(authHeader('new-commenter', 'n@example.com'))
      .send({ text: 'brand new' });

    const stored = await Recipe.findById(recipe.id).lean();
    expect(stored!.comments).toHaveLength(3);
    expect(stored!.commentCount).toBe(3);
  });
});

describe('comment cap', () => {
  it('refuses to grow a recipe past the limit', async () => {
    const recipe = await createRecipe({ author: OWNER });

    // Fill it directly; posting 500 comments over HTTP would be slow and is not
    // what this test is about.
    await Recipe.collection.updateOne(
      { _id: recipe._id },
      {
        $set: {
          comments: Array.from({ length: LIMITS.commentsPerRecipe }, (_, index) => ({
            text: `filler ${index}`,
            authorId: 'filler',
            authorEmail: 'filler@example.com',
            createdAt: new Date(),
          })),
          commentCount: LIMITS.commentsPerRecipe,
        },
      },
    );

    const res = await api()
      .post(`/api/recipes/${recipe.id}/comments`)
      .set(authHeader('one-too-many', 'x@example.com'))
      .send({ text: 'no room' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('conflict');

    const stored = await Recipe.findById(recipe.id).lean();
    expect(stored!.comments).toHaveLength(LIMITS.commentsPerRecipe);
  });

  it('still distinguishes a missing recipe from a full one', async () => {
    const res = await api()
      .post('/api/recipes/507f1f77bcf86cd799439011/comments')
      .set(authHeader('someone', 's@example.com'))
      .send({ text: 'hello' });

    expect(res.status).toBe(404);
  });
});

describe('malformed requests', () => {
  it('answers truncated JSON with 400, not 500', async () => {
    const res = await api()
      .post('/api/recipes')
      .set(authHeader(OWNER, 'owner@example.com'))
      .set('Content-Type', 'application/json')
      .send('{"title": ');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_json');
  });

  it('answers an oversized body with 413, not 500', async () => {
    const res = await api()
      .post('/api/recipes')
      .set(authHeader(OWNER, 'owner@example.com'))
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ title: 'x'.repeat(300_000) }));

    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('payload_too_large');
  });
});
