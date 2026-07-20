import { describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { Recipe } from '../src/models/Recipe.js';
import { api, authHeader, createProfile, createRecipe, sleep } from './helpers.js';

const OWNER = 'owner-uid';
const COMMENTER = 'commenter-uid';
const STRANGER = 'stranger-uid';

async function postComment(recipeId: string, uid: string, text: string) {
  return api().post(`/api/recipes/${recipeId}/comments`).set(authHeader(uid)).send({ text });
}

describe('POST /api/recipes/:id/comments', () => {
  it('creates a comment and increments commentCount', async () => {
    const recipe = await createRecipe({ author: OWNER });

    const res = await postComment(recipe.id, COMMENTER, 'Looks delicious');

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      text: 'Looks delicious',
      authorId: COMMENTER,
      editedAt: null,
    });
    expect(res.body._id).toBeDefined();
    expect(res.body.createdAt).toBeDefined();
    // The commenter's address is stored but never serialised back.
    expect(res.body).not.toHaveProperty('authorEmail');

    const stored = await Recipe.findById(recipe.id).lean();
    expect(stored!.comments).toHaveLength(1);
    expect(stored!.commentCount).toBe(1);
    expect(stored!.comments[0]!.authorEmail).toBe(`${COMMENTER}@example.com`);
  });

  it('uses the saved profile display name when there is one', async () => {
    const recipe = await createRecipe({ author: OWNER });
    await createProfile(COMMENTER, { displayName: 'Chef Commenter' });

    const res = await postComment(recipe.id, COMMENTER, 'Hi');

    expect(res.body.authorDisplayName).toBe('Chef Commenter');
  });

  it('commentCount keeps up across several comments', async () => {
    const recipe = await createRecipe({ author: OWNER });

    await postComment(recipe.id, COMMENTER, 'one');
    await postComment(recipe.id, STRANGER, 'two');
    await postComment(recipe.id, COMMENTER, 'three');

    const detail = await api().get(`/api/recipes/${recipe.id}`);
    expect(detail.body.commentCount).toBe(3);

    const list = await api().get('/api/recipes');
    expect(list.body.items[0].commentCount).toBe(3);
  });

  it('SECURITY: comment text is stripped of all markup', async () => {
    const recipe = await createRecipe({ author: OWNER });

    const res = await postComment(recipe.id, COMMENTER, '<script>x</script>hello');

    expect(res.status).toBe(201);
    expect(res.body.text).not.toContain('<');
    expect(res.body.text).not.toContain('script');
    expect(res.body.text).toContain('hello');

    const stored = await Recipe.findById(recipe.id).lean();
    expect(stored!.comments[0]!.text).toBe(res.body.text);
  });

  it('SECURITY: even allowed rich-text tags are stripped from comments', async () => {
    const recipe = await createRecipe({ author: OWNER });

    const res = await postComment(recipe.id, COMMENTER, '<p>plain</p><img src=x onerror=alert(1)>');

    expect(res.status).toBe(201);
    expect(res.body.text).not.toMatch(/<[a-z]/i);
    expect(res.body.text).not.toContain('onerror');
    expect(res.body.text).toContain('plain');
  });

  it('rejects an empty comment', async () => {
    const recipe = await createRecipe({ author: OWNER });

    const res = await postComment(recipe.id, COMMENTER, '');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('bad_request');
  });

  it('rejects a whitespace-only comment', async () => {
    const recipe = await createRecipe({ author: OWNER });

    const res = await postComment(recipe.id, COMMENTER, '   \n\t  ');

    expect(res.status).toBe(400);
    expect(await Recipe.findById(recipe.id).lean().then((r) => r!.comments.length)).toBe(0);
  });

  it('rejects a comment that is markup only (empty once stripped)', async () => {
    const recipe = await createRecipe({ author: OWNER });

    const res = await postComment(recipe.id, COMMENTER, '<script>alert(1)</script>');

    expect(res.status).toBe(400);
  });

  it('rejects a comment over 2000 characters', async () => {
    const recipe = await createRecipe({ author: OWNER });

    const res = await postComment(recipe.id, COMMENTER, 'x'.repeat(2001));

    expect(res.status).toBe(400);
  });

  it('accepts a comment of exactly 2000 characters', async () => {
    const recipe = await createRecipe({ author: OWNER });

    const res = await postComment(recipe.id, COMMENTER, 'x'.repeat(2000));

    expect(res.status).toBe(201);
  });

  it('rejects unknown body keys', async () => {
    const recipe = await createRecipe({ author: OWNER });

    const res = await api()
      .post(`/api/recipes/${recipe.id}/comments`)
      .set(authHeader(COMMENTER))
      .send({ text: 'hi', authorId: 'someone-else' });

    expect(res.status).toBe(400);
  });

  it('requires authentication', async () => {
    const recipe = await createRecipe({ author: OWNER });

    const res = await api().post(`/api/recipes/${recipe.id}/comments`).send({ text: 'hi' });

    expect(res.status).toBe(401);
  });

  it('404s for a recipe that does not exist', async () => {
    const id = new mongoose.Types.ObjectId().toString();

    const res = await postComment(id, COMMENTER, 'hi');

    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/recipes/:id/comments/:commentId', () => {
  it('lets the comment author edit and stamps editedAt', async () => {
    const recipe = await createRecipe({ author: OWNER });
    const created = await postComment(recipe.id, COMMENTER, 'original');

    const res = await api()
      .patch(`/api/recipes/${recipe.id}/comments/${created.body._id}`)
      .set(authHeader(COMMENTER))
      .send({ text: 'edited' });

    expect(res.status).toBe(200);
    expect(res.body.text).toBe('edited');
    expect(res.body.editedAt).not.toBeNull();
    expect(Number.isNaN(Date.parse(res.body.editedAt))).toBe(false);

    const stored = await Recipe.findById(recipe.id).lean();
    expect(stored!.comments[0]!.text).toBe('edited');
  });

  it('sanitises the edited text too', async () => {
    const recipe = await createRecipe({ author: OWNER });
    const created = await postComment(recipe.id, COMMENTER, 'original');

    const res = await api()
      .patch(`/api/recipes/${recipe.id}/comments/${created.body._id}`)
      .set(authHeader(COMMENTER))
      .send({ text: '<script>bad</script>clean' });

    expect(res.status).toBe(200);
    expect(res.body.text).not.toContain('<');
    expect(res.body.text).toContain('clean');
  });

  it('a different user cannot edit someone else’s comment', async () => {
    const recipe = await createRecipe({ author: OWNER });
    const created = await postComment(recipe.id, COMMENTER, 'original');

    const res = await api()
      .patch(`/api/recipes/${recipe.id}/comments/${created.body._id}`)
      .set(authHeader(STRANGER))
      .send({ text: 'hijacked' });

    expect(res.status).toBe(403);

    const stored = await Recipe.findById(recipe.id).lean();
    expect(stored!.comments[0]!.text).toBe('original');
  });

  it('SECURITY: the recipe owner cannot rewrite someone else’s comment either', async () => {
    const recipe = await createRecipe({ author: OWNER });
    const created = await postComment(recipe.id, COMMENTER, 'original');

    const res = await api()
      .patch(`/api/recipes/${recipe.id}/comments/${created.body._id}`)
      .set(authHeader(OWNER))
      .send({ text: 'words in their mouth' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');

    const stored = await Recipe.findById(recipe.id).lean();
    expect(stored!.comments[0]!.text).toBe('original');
    expect(stored!.comments[0]!.editedAt).toBeNull();
  });

  it('404s for a comment id that is not on the recipe', async () => {
    const recipe = await createRecipe({ author: OWNER });
    const missing = new mongoose.Types.ObjectId().toString();

    const res = await api()
      .patch(`/api/recipes/${recipe.id}/comments/${missing}`)
      .set(authHeader(COMMENTER))
      .send({ text: 'x' });

    expect(res.status).toBe(404);
  });

  it('400s for a malformed comment id', async () => {
    const recipe = await createRecipe({ author: OWNER });

    const res = await api()
      .patch(`/api/recipes/${recipe.id}/comments/nope`)
      .set(authHeader(COMMENTER))
      .send({ text: 'x' });

    expect(res.status).toBe(400);
  });

  it('requires authentication', async () => {
    const recipe = await createRecipe({ author: OWNER });
    const created = await postComment(recipe.id, COMMENTER, 'original');

    const res = await api()
      .patch(`/api/recipes/${recipe.id}/comments/${created.body._id}`)
      .send({ text: 'x' });

    expect(res.status).toBe(401);
  });
});

describe('DELETE /api/recipes/:id/comments/:commentId', () => {
  it('the comment author can delete their own comment', async () => {
    const recipe = await createRecipe({ author: OWNER });
    const created = await postComment(recipe.id, COMMENTER, 'bye');

    const res = await api()
      .delete(`/api/recipes/${recipe.id}/comments/${created.body._id}`)
      .set(authHeader(COMMENTER));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });

    const stored = await Recipe.findById(recipe.id).lean();
    expect(stored!.comments).toHaveLength(0);
    expect(stored!.commentCount).toBe(0);
  });

  it('the recipe owner can moderate another user’s comment', async () => {
    const recipe = await createRecipe({ author: OWNER });
    const created = await postComment(recipe.id, COMMENTER, 'spam');

    const res = await api()
      .delete(`/api/recipes/${recipe.id}/comments/${created.body._id}`)
      .set(authHeader(OWNER));

    expect(res.status).toBe(200);
    expect(await Recipe.findById(recipe.id).lean().then((r) => r!.commentCount)).toBe(0);
  });

  it('an unrelated user cannot delete a comment', async () => {
    const recipe = await createRecipe({ author: OWNER });
    const created = await postComment(recipe.id, COMMENTER, 'keep me');

    const res = await api()
      .delete(`/api/recipes/${recipe.id}/comments/${created.body._id}`)
      .set(authHeader(STRANGER));

    expect(res.status).toBe(403);
    expect(await Recipe.findById(recipe.id).lean().then((r) => r!.comments.length)).toBe(1);
  });

  it('requires authentication', async () => {
    const recipe = await createRecipe({ author: OWNER });
    const created = await postComment(recipe.id, COMMENTER, 'x');

    const res = await api().delete(
      `/api/recipes/${recipe.id}/comments/${created.body._id}`,
    );

    expect(res.status).toBe(401);
  });

  it('404s for a comment that is not there', async () => {
    const recipe = await createRecipe({ author: OWNER });
    const missing = new mongoose.Types.ObjectId().toString();

    const res = await api()
      .delete(`/api/recipes/${recipe.id}/comments/${missing}`)
      .set(authHeader(OWNER));

    expect(res.status).toBe(404);
  });
});

describe('GET /api/recipes/:id/comments', () => {
  it('is paginated and newest-first', async () => {
    const recipe = await createRecipe({ author: OWNER });

    await postComment(recipe.id, COMMENTER, 'first');
    await sleep(15);
    await postComment(recipe.id, COMMENTER, 'second');
    await sleep(15);
    await postComment(recipe.id, COMMENTER, 'third');

    const page1 = await api().get(`/api/recipes/${recipe.id}/comments?page=1&limit=2`);

    expect(page1.status).toBe(200);
    expect(page1.body).toMatchObject({ page: 1, limit: 2, total: 3, totalPages: 2 });
    expect(page1.body.items.map((c: { text: string }) => c.text)).toEqual(['third', 'second']);

    const page2 = await api().get(`/api/recipes/${recipe.id}/comments?page=2&limit=2`);
    expect(page2.body.items.map((c: { text: string }) => c.text)).toEqual(['first']);
  });

  it('is readable anonymously', async () => {
    const recipe = await createRecipe({ author: OWNER });
    await postComment(recipe.id, COMMENTER, 'public');

    const res = await api().get(`/api/recipes/${recipe.id}/comments`);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
  });

  it('404s for an unknown recipe and 400s for a malformed id', async () => {
    const missing = new mongoose.Types.ObjectId().toString();

    expect((await api().get(`/api/recipes/${missing}/comments`)).status).toBe(404);
    expect((await api().get('/api/recipes/nope/comments')).status).toBe(400);
  });
});
