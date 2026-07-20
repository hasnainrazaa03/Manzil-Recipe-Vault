import { describe, expect, it } from 'vitest';
import { Recipe } from '../src/models/Recipe.js';
import { Comment } from '../src/models/Comment.js';
import { api, authHeader, createRecipe } from './helpers.js';

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
 * Ratings are still an array on the recipe, and their counter is derived with
 * `$size` inside the same atomic update. Comments have moved to their own
 * collection, so the equivalent guarantee is that `commentCount` is recomputed
 * from `Comment.countDocuments` after every write and therefore still agrees
 * with the number of comment documents after any interleaving.
 */

const OWNER = 'owner-uid';

/** Fires requests genuinely in parallel rather than merely in a loop. */
const inParallel = <T>(count: number, make: (index: number) => Promise<T>) =>
  Promise.all(Array.from({ length: count }, (_, index) => make(index)));

/** The invariant every comment test here shares. */
async function expectCounterMatchesCollection(recipeId: string) {
  const [stored, actual] = await Promise.all([
    Recipe.findById(recipeId).lean(),
    Comment.countDocuments({ recipe: recipeId }),
  ]);
  expect(stored!.commentCount).toBe(actual);
  return actual;
}

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
  it('keeps commentCount consistent with the collection', async () => {
    const recipe = await createRecipe({ author: OWNER });

    const responses = await inParallel(6, (index) =>
      api()
        .post(`/api/recipes/${recipe.id}/comments`)
        .set(authHeader(`commenter-${index}`, `c${index}@example.com`))
        .send({ text: `comment ${index}` }),
    );

    expect(responses.every((res) => res.status === 201)).toBe(true);

    expect(await Comment.countDocuments({ recipe: recipe.id })).toBe(6);
    expect(await expectCounterMatchesCollection(recipe.id)).toBe(6);
  });

  it('keeps commentCount consistent when parallel deletes land together', async () => {
    const recipe = await createRecipe({ author: OWNER });

    const created = await inParallel(6, (index) =>
      api()
        .post(`/api/recipes/${recipe.id}/comments`)
        .set(authHeader(`commenter-${index}`, `c${index}@example.com`))
        .send({ text: `comment ${index}` }),
    );
    expect(await Comment.countDocuments({ recipe: recipe.id })).toBe(6);

    // Four of the six go at once, each deleted by its own author.
    const doomed = created.slice(0, 4);
    const responses = await Promise.all(
      doomed.map((res, index) =>
        api()
          .delete(`/api/recipes/${recipe.id}/comments/${res.body._id}`)
          .set(authHeader(`commenter-${index}`, `c${index}@example.com`)),
      ),
    );

    expect(responses.every((res) => res.status === 200)).toBe(true);
    expect(await Comment.countDocuments({ recipe: recipe.id })).toBe(2);
    expect(await expectCounterMatchesCollection(recipe.id)).toBe(2);
  });

  it('keeps commentCount consistent when replies arrive in parallel', async () => {
    const recipe = await createRecipe({ author: OWNER });
    const root = await api()
      .post(`/api/recipes/${recipe.id}/comments`)
      .set(authHeader('root-author', 'root@example.com'))
      .send({ text: 'root' });

    const responses = await inParallel(5, (index) =>
      api()
        .post(`/api/recipes/${recipe.id}/comments`)
        .set(authHeader(`replier-${index}`, `r${index}@example.com`))
        .send({ text: `reply ${index}`, parent: root.body._id }),
    );

    expect(responses.every((res) => res.status === 201)).toBe(true);
    // Replies are comments too, so the counter includes them.
    expect(await expectCounterMatchesCollection(recipe.id)).toBe(6);
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

    expect(await expectCounterMatchesCollection(recipe.id)).toBe(2);
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

    expect(await expectCounterMatchesCollection(recipe.id)).toBe(1);
    expect(await Comment.exists({ recipe: recipe.id, text: 'going away' })).toBeNull();
  });

  it('recounts correctly when a thread delete races an add', async () => {
    const recipe = await createRecipe({ author: OWNER });
    const root = await api()
      .post(`/api/recipes/${recipe.id}/comments`)
      .set(authHeader('deleter', 'deleter@example.com'))
      .send({ text: 'going away' });
    await api()
      .post(`/api/recipes/${recipe.id}/comments`)
      .set(authHeader('replier', 'replier@example.com'))
      .send({ text: 'going away too', parent: root.body._id });

    await Promise.all([
      api()
        .delete(`/api/recipes/${recipe.id}/comments/${root.body._id}`)
        .set(authHeader('deleter', 'deleter@example.com')),
      api()
        .post(`/api/recipes/${recipe.id}/comments`)
        .set(authHeader('adder', 'adder@example.com'))
        .send({ text: 'arriving' }),
    ]);

    // The parent and its reply both went; the new root stayed.
    expect(await expectCounterMatchesCollection(recipe.id)).toBe(1);
    expect(await Comment.countDocuments({ recipe: recipe.id, parent: null })).toBe(1);
  });

  it('keeps the counter right on a legacy recipe that has no counter yet', async () => {
    // `$inc` would have been wrong here: it would set the counter to 1 on a
    // recipe that already had comments but no stored count. The counter is
    // recomputed from the collection instead — and the embedded array a legacy
    // recipe still carries is not part of that count.
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

    expect(await expectCounterMatchesCollection(recipe.id)).toBe(1);
    // The un-migrated array is left exactly where it was — the migration, not a
    // request path, is what moves it.
    expect(await Recipe.findById(recipe.id).lean().then((r) => r!.comments)).toHaveLength(2);
  });
});

describe('commenting on a recipe that is not there', () => {
  it('404s rather than creating an orphaned comment', async () => {
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
