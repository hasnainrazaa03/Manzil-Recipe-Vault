import { describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { Recipe } from '../src/models/Recipe.js';
import { api, authHeader, createRecipe } from './helpers.js';

const AUTHOR = 'author-uid';
const RATER = 'rater-uid';
const OTHER = 'other-uid';

describe('PUT /api/recipes/:id/rating', () => {
  it('records a rating and updates the average and count', async () => {
    const recipe = await createRecipe({ author: AUTHOR });

    const res = await api()
      .put(`/api/recipes/${recipe.id}/rating`)
      .set(authHeader(RATER))
      .send({ score: 4 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ averageRating: 4, ratingCount: 1, userScore: 4 });

    const stored = await Recipe.findById(recipe.id).lean();
    expect(stored!.ratings).toHaveLength(1);
    expect(stored!.ratings[0]).toMatchObject({ userId: RATER, score: 4 });
  });

  it.each([1, 2, 3, 4, 5])('accepts the valid score %i', async (score) => {
    const recipe = await createRecipe({ author: AUTHOR });

    const res = await api()
      .put(`/api/recipes/${recipe.id}/rating`)
      .set(authHeader(RATER))
      .send({ score });

    expect(res.status).toBe(200);
    expect(res.body.averageRating).toBe(score);
  });

  it('re-rating by the same user updates rather than appends', async () => {
    const recipe = await createRecipe({ author: AUTHOR });

    await api()
      .put(`/api/recipes/${recipe.id}/rating`)
      .set(authHeader(RATER))
      .send({ score: 1 });

    const second = await api()
      .put(`/api/recipes/${recipe.id}/rating`)
      .set(authHeader(RATER))
      .send({ score: 5 });

    expect(second.status).toBe(200);
    expect(second.body).toEqual({ averageRating: 5, ratingCount: 1, userScore: 5 });

    const stored = await Recipe.findById(recipe.id).lean();
    expect(stored!.ratings).toHaveLength(1);
    expect(stored!.ratingCount).toBe(1);
  });

  it('averages across users', async () => {
    const recipe = await createRecipe({ author: AUTHOR });

    await api().put(`/api/recipes/${recipe.id}/rating`).set(authHeader(RATER)).send({ score: 5 });
    const res = await api()
      .put(`/api/recipes/${recipe.id}/rating`)
      .set(authHeader(OTHER))
      .send({ score: 2 });

    expect(res.body).toEqual({ averageRating: 3.5, ratingCount: 2, userScore: 2 });
  });

  it('rounds the average to one decimal place', async () => {
    const recipe = await createRecipe({ author: AUTHOR });

    // 5 + 4 + 4 = 13 / 3 = 4.333… → 4.3
    await api().put(`/api/recipes/${recipe.id}/rating`).set(authHeader('u1')).send({ score: 5 });
    await api().put(`/api/recipes/${recipe.id}/rating`).set(authHeader('u2')).send({ score: 4 });
    const res = await api()
      .put(`/api/recipes/${recipe.id}/rating`)
      .set(authHeader('u3'))
      .send({ score: 4 });

    expect(res.body.averageRating).toBe(4.3);

    const stored = await Recipe.findById(recipe.id).lean();
    expect(stored!.averageRating).toBe(4.3);
  });

  it('SECURITY: the author cannot rate their own recipe', async () => {
    const recipe = await createRecipe({ author: AUTHOR });

    const res = await api()
      .put(`/api/recipes/${recipe.id}/rating`)
      .set(authHeader(AUTHOR))
      .send({ score: 5 });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');

    const stored = await Recipe.findById(recipe.id).lean();
    expect(stored!.ratings).toHaveLength(0);
    expect(stored!.averageRating).toBe(0);
    expect(stored!.ratingCount).toBe(0);
  });

  it('requires authentication', async () => {
    const recipe = await createRecipe({ author: AUTHOR });

    const res = await api().put(`/api/recipes/${recipe.id}/rating`).send({ score: 4 });

    expect(res.status).toBe(401);
  });

  it('404s for a recipe that does not exist', async () => {
    const id = new mongoose.Types.ObjectId().toString();

    const res = await api().put(`/api/recipes/${id}/rating`).set(authHeader(RATER)).send({ score: 4 });

    expect(res.status).toBe(404);
  });

  it('400s for a malformed recipe id', async () => {
    const res = await api()
      .put('/api/recipes/not-an-id/rating')
      .set(authHeader(RATER))
      .send({ score: 4 });

    expect(res.status).toBe(400);
  });

  describe('score validation', () => {
    it.each([
      ['0 (below range)', 0],
      ['6 (above range)', 6],
      ['4.5 (not an integer)', 4.5],
      ['"abc" (not a number)', 'abc'],
      ['null', null],
      ['-1', -1],
    ])('rejects %s', async (_label, score) => {
      const recipe = await createRecipe({ author: AUTHOR });

      const res = await api()
        .put(`/api/recipes/${recipe.id}/rating`)
        .set(authHeader(RATER))
        .send({ score });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('bad_request');

      const stored = await Recipe.findById(recipe.id).lean();
      expect(stored!.ratings).toHaveLength(0);
    });

    it('rejects a missing score', async () => {
      const recipe = await createRecipe({ author: AUTHOR });

      const res = await api()
        .put(`/api/recipes/${recipe.id}/rating`)
        .set(authHeader(RATER))
        .send({});

      expect(res.status).toBe(400);
    });

    it('rejects unknown keys (strict schema)', async () => {
      const recipe = await createRecipe({ author: AUTHOR });

      const res = await api()
        .put(`/api/recipes/${recipe.id}/rating`)
        .set(authHeader(RATER))
        .send({ score: 4, userId: 'someone-else' });

      expect(res.status).toBe(400);
    });

    it('COERCES a numeric string: score "5" is accepted', async () => {
      const recipe = await createRecipe({ author: AUTHOR });

      const res = await api()
        .put(`/api/recipes/${recipe.id}/rating`)
        .set(authHeader(RATER))
        .send({ score: '5' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ averageRating: 5, ratingCount: 1, userScore: 5 });

      const stored = await Recipe.findById(recipe.id).lean();
      expect(stored!.ratings[0]!.score).toBe(5);
    });
  });
});

describe('DELETE /api/recipes/:id/rating', () => {
  it('removes the caller’s rating and recalculates', async () => {
    const recipe = await createRecipe({ author: AUTHOR });

    await api().put(`/api/recipes/${recipe.id}/rating`).set(authHeader(RATER)).send({ score: 5 });
    await api().put(`/api/recipes/${recipe.id}/rating`).set(authHeader(OTHER)).send({ score: 3 });

    const res = await api().delete(`/api/recipes/${recipe.id}/rating`).set(authHeader(RATER));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ averageRating: 3, ratingCount: 1, userScore: 0 });

    const stored = await Recipe.findById(recipe.id).lean();
    expect(stored!.ratings.map((r) => r.userId)).toEqual([OTHER]);
  });

  it('resets the average to 0 when the last rating goes', async () => {
    const recipe = await createRecipe({ author: AUTHOR });
    await api().put(`/api/recipes/${recipe.id}/rating`).set(authHeader(RATER)).send({ score: 4 });

    const res = await api().delete(`/api/recipes/${recipe.id}/rating`).set(authHeader(RATER));

    expect(res.body).toEqual({ averageRating: 0, ratingCount: 0, userScore: 0 });
  });

  /**
   * The regression that mattered: `pull({ userId })` was a no-op in memory, so
   * the counters were recalculated from the stale array while `save()` still
   * emitted a `$pull` Mongo honoured — leaving a stored document whose
   * `ratings` array and `ratingCount`/`averageRating` disagreed. Assert on the
   * *stored* document, since the response alone would not have caught it.
   */
  it('leaves the stored document internally consistent after a delete', async () => {
    const recipe = await createRecipe({ author: AUTHOR });

    await api().put(`/api/recipes/${recipe.id}/rating`).set(authHeader('u1')).send({ score: 5 });
    await api().put(`/api/recipes/${recipe.id}/rating`).set(authHeader('u2')).send({ score: 2 });
    await api().put(`/api/recipes/${recipe.id}/rating`).set(authHeader('u3')).send({ score: 3 });

    await api().delete(`/api/recipes/${recipe.id}/rating`).set(authHeader('u1'));

    const stored = await Recipe.findById(recipe.id).lean();
    const scores = stored!.ratings.map((r) => r.score);

    expect(stored!.ratings.map((r) => r.userId).sort()).toEqual(['u2', 'u3']);
    // The three fields must describe the same set of ratings.
    expect(stored!.ratingCount).toBe(stored!.ratings.length);
    expect(stored!.averageRating).toBe(
      Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10,
    );
    expect(stored!.ratingCount).toBe(2);
    expect(stored!.averageRating).toBe(2.5);

    // And the read paths agree with the stored document.
    const detail = await api().get(`/api/recipes/${recipe.id}`).set(authHeader('u1'));
    expect(detail.body.ratingCount).toBe(2);
    expect(detail.body.averageRating).toBe(2.5);
    expect(detail.body.viewer.userScore).toBe(0);
  });

  it('deleting the only rating zeroes both counters in storage', async () => {
    const recipe = await createRecipe({ author: AUTHOR });
    await api().put(`/api/recipes/${recipe.id}/rating`).set(authHeader(RATER)).send({ score: 4 });

    await api().delete(`/api/recipes/${recipe.id}/rating`).set(authHeader(RATER));

    const stored = await Recipe.findById(recipe.id).lean();
    expect(stored!.ratings).toHaveLength(0);
    expect(stored!.ratingCount).toBe(0);
    expect(stored!.averageRating).toBe(0);
  });

  it('re-rating after a delete starts from a clean slate', async () => {
    const recipe = await createRecipe({ author: AUTHOR });

    await api().put(`/api/recipes/${recipe.id}/rating`).set(authHeader(RATER)).send({ score: 5 });
    await api().delete(`/api/recipes/${recipe.id}/rating`).set(authHeader(RATER));
    const again = await api()
      .put(`/api/recipes/${recipe.id}/rating`)
      .set(authHeader(RATER))
      .send({ score: 1 });

    expect(again.body).toEqual({ averageRating: 1, ratingCount: 1, userScore: 1 });

    const stored = await Recipe.findById(recipe.id).lean();
    expect(stored!.ratings).toHaveLength(1);
    expect(stored!.ratingCount).toBe(1);
  });

  it('is a no-op when the caller never rated', async () => {
    const recipe = await createRecipe({
      author: AUTHOR,
      ratings: [{ userId: OTHER, score: 4 }],
    });

    const res = await api().delete(`/api/recipes/${recipe.id}/rating`).set(authHeader(RATER));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ averageRating: 4, ratingCount: 1, userScore: 0 });
  });

  it('requires authentication', async () => {
    const recipe = await createRecipe({ author: AUTHOR });

    const res = await api().delete(`/api/recipes/${recipe.id}/rating`);

    expect(res.status).toBe(401);
  });
});

describe('rating visibility', () => {
  it('the detail endpoint reports the caller’s own score', async () => {
    const recipe = await createRecipe({ author: AUTHOR });
    await api().put(`/api/recipes/${recipe.id}/rating`).set(authHeader(RATER)).send({ score: 2 });

    const mine = await api().get(`/api/recipes/${recipe.id}`).set(authHeader(RATER));
    const theirs = await api().get(`/api/recipes/${recipe.id}`).set(authHeader(OTHER));

    expect(mine.body.viewer.userScore).toBe(2);
    expect(theirs.body.viewer.userScore).toBe(0);
  });
});
