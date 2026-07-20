import { describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { Recipe } from '../src/models/Recipe.js';
import { Comment } from '../src/models/Comment.js';
import { EMAIL_PATTERN, api, authHeader, createProfile, createRecipe, expectNoEmailLeak, sleep } from './helpers.js';

/**
 * Comments are their own collection now, so "what is stored" is a query against
 * `Comment` rather than a look inside the recipe document. `commentCount` stays
 * on the recipe as a denormalised counter and is recomputed from the collection
 * after every write, so it is asserted against `Comment.countDocuments` rather
 * than against itself.
 */

const OWNER = 'owner-uid';
const COMMENTER = 'commenter-uid';
const STRANGER = 'stranger-uid';

async function postComment(recipeId: string, uid: string, text: string, parent?: string) {
  return api()
    .post(`/api/recipes/${recipeId}/comments`)
    .set(authHeader(uid))
    .send(parent ? { text, parent } : { text });
}

/** The stored comments for a recipe, oldest first. */
async function storedComments(recipeId: string) {
  return Comment.find({ recipe: recipeId }).sort({ createdAt: 1 }).lean();
}

async function storedCount(recipeId: string) {
  const recipe = await Recipe.findById(recipeId).lean();
  return recipe!.commentCount;
}

describe('POST /api/recipes/:id/comments', () => {
  it('creates a comment and increments commentCount', async () => {
    const recipe = await createRecipe({ author: OWNER });

    const res = await postComment(recipe.id, COMMENTER, 'Looks delicious');

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      text: 'Looks delicious',
      authorId: COMMENTER,
      recipe: recipe.id,
      parent: null,
      editedAt: null,
      replies: [],
    });
    expect(res.body._id).toBeDefined();
    expect(res.body.createdAt).toBeDefined();
    // The collection has no email column at all, so there is nothing to strip.
    expect(res.body).not.toHaveProperty('authorEmail');

    const stored = await storedComments(recipe.id);
    expect(stored).toHaveLength(1);
    expect(stored[0]).not.toHaveProperty('authorEmail');
    expect(String(stored[0]!.recipe)).toBe(recipe.id);
    // Nothing is written back into the recipe document itself.
    expect(await storedCount(recipe.id)).toBe(1);
    expect(await Recipe.findById(recipe.id).lean().then((r) => r!.comments)).toHaveLength(0);
  });

  it('uses the saved profile display name when there is one', async () => {
    const recipe = await createRecipe({ author: OWNER });
    await createProfile(COMMENTER, { displayName: 'Chef Commenter' });

    const res = await postComment(recipe.id, COMMENTER, 'Hi');

    expect(res.body.authorName).toBe('Chef Commenter');
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

    const stored = await storedComments(recipe.id);
    expect(stored[0]!.text).toBe(res.body.text);
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
    expect(await Comment.countDocuments({ recipe: recipe.id })).toBe(0);
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

    const stored = await storedComments(recipe.id);
    expect(stored[0]!.text).toBe('edited');
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

    const stored = await storedComments(recipe.id);
    expect(stored[0]!.text).toBe('original');
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

    const stored = await storedComments(recipe.id);
    expect(stored[0]!.text).toBe('original');
    expect(stored[0]!.editedAt).toBeNull();
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
    expect(res.body).toEqual({ success: true, commentCount: 0 });

    expect(await Comment.countDocuments({ recipe: recipe.id })).toBe(0);
    expect(await storedCount(recipe.id)).toBe(0);
  });

  it('the recipe owner can moderate another user’s comment', async () => {
    const recipe = await createRecipe({ author: OWNER });
    const created = await postComment(recipe.id, COMMENTER, 'spam');

    const res = await api()
      .delete(`/api/recipes/${recipe.id}/comments/${created.body._id}`)
      .set(authHeader(OWNER));

    expect(res.status).toBe(200);
    expect(await Comment.countDocuments({ recipe: recipe.id })).toBe(0);
    expect(await storedCount(recipe.id)).toBe(0);
  });

  it('an unrelated user cannot delete a comment', async () => {
    const recipe = await createRecipe({ author: OWNER });
    const created = await postComment(recipe.id, COMMENTER, 'keep me');

    const res = await api()
      .delete(`/api/recipes/${recipe.id}/comments/${created.body._id}`)
      .set(authHeader(STRANGER));

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');
    expect(await Comment.countDocuments({ recipe: recipe.id })).toBe(1);
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

  it('paginates top-level comments and does not count replies as items', async () => {
    const recipe = await createRecipe({ author: OWNER });

    const roots: string[] = [];
    for (const text of ['one', 'two', 'three']) {
      const created = await postComment(recipe.id, COMMENTER, text);
      roots.push(created.body._id);
      await sleep(15);
    }
    // Three replies hung off the oldest root. They must not shift the pages.
    for (const text of ['r1', 'r2', 'r3']) {
      await postComment(recipe.id, STRANGER, text, roots[0]);
    }

    const page1 = await api().get(`/api/recipes/${recipe.id}/comments?page=1&limit=2`);
    expect(page1.status).toBe(200);
    expect(page1.body).toMatchObject({ page: 1, limit: 2, total: 3, totalPages: 2 });
    expect(page1.body.items.map((c: { text: string }) => c.text)).toEqual(['three', 'two']);
    expect(page1.body.items.every((c: { parent: null }) => c.parent === null)).toBe(true);

    const page2 = await api().get(`/api/recipes/${recipe.id}/comments?page=2&limit=2`);
    expect(page2.body.items.map((c: { text: string }) => c.text)).toEqual(['one']);
    // The replies travel with their parent, oldest first, rather than as items.
    expect(page2.body.items[0].replies.map((r: { text: string }) => r.text)).toEqual([
      'r1',
      'r2',
      'r3',
    ]);

    // `commentCount` counts everything, replies included — it is what a card renders.
    expect(await storedCount(recipe.id)).toBe(6);
  });

  it('404s for an unknown recipe and 400s for a malformed id', async () => {
    const missing = new mongoose.Types.ObjectId().toString();

    expect((await api().get(`/api/recipes/${missing}/comments`)).status).toBe(404);
    expect((await api().get('/api/recipes/nope/comments')).status).toBe(400);
  });

  /**
   * The read and write paths must describe the same comment.
   *
   * FINDINGS #8 was a stale duplicate registration of this route that still read
   * the embedded array: `POST` succeeded, the document existed, and the list
   * answered `[]` forever. Every assertion that only ever looked at one side of
   * the pair passed throughout. This one compares them field by field.
   */
  it('reflects, field for field, what POST said it created', async () => {
    const recipe = await createRecipe({ author: OWNER });
    await createProfile(COMMENTER, { displayName: 'Chef Commenter' });

    const created = await postComment(recipe.id, COMMENTER, 'the one and only');
    expect(created.status).toBe(201);

    const res = await api().get(`/api/recipes/${recipe.id}/comments`);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({
      _id: created.body._id,
      text: 'the one and only',
      authorId: COMMENTER,
      authorName: 'Chef Commenter',
      parent: null,
      replies: [],
    });

    // And the detail endpoint tells the same story as both of them.
    const detail = await api().get(`/api/recipes/${recipe.id}`);
    expect(detail.body.comments[0]._id).toBe(created.body._id);
    expect(detail.body.commentCount).toBe(1);
    expect(await Comment.countDocuments({ recipe: recipe.id })).toBe(1);
  });

  it('reflects an edit and a delete just as promptly', async () => {
    const recipe = await createRecipe({ author: OWNER });
    const created = await postComment(recipe.id, COMMENTER, 'before');

    await api()
      .patch(`/api/recipes/${recipe.id}/comments/${created.body._id}`)
      .set(authHeader(COMMENTER))
      .send({ text: 'after' });

    const edited = await api().get(`/api/recipes/${recipe.id}/comments`);
    expect(edited.body.items[0].text).toBe('after');
    expect(edited.body.items[0].editedAt).not.toBeNull();

    await api()
      .delete(`/api/recipes/${recipe.id}/comments/${created.body._id}`)
      .set(authHeader(COMMENTER));

    const gone = await api().get(`/api/recipes/${recipe.id}/comments`);
    expect(gone.body.items).toEqual([]);
    expect(gone.body.total).toBe(0);
  });

  it('ignores an embedded array a legacy recipe still carries', async () => {
    // The shape that made the stale handler look like it worked: a recipe with
    // an un-migrated embedded array. The list reads the collection only.
    const recipe = await createRecipe({ author: OWNER });
    await Recipe.collection.updateOne(
      { _id: recipe._id },
      {
        $set: {
          comments: [
            { text: 'embedded ghost', authorId: 'x', authorEmail: 'x@example.com', createdAt: new Date() },
          ],
        },
      },
    );

    await postComment(recipe.id, COMMENTER, 'the real one');

    const res = await api().get(`/api/recipes/${recipe.id}/comments`);

    expect(res.body.total).toBe(1);
    expect(res.body.items.map((c: { text: string }) => c.text)).toEqual(['the real one']);
    expectNoEmailLeak(res.body);
  });
});

describe('replies', () => {
  it('nests a reply under its parent in the detail response', async () => {
    const recipe = await createRecipe({ author: OWNER });
    const root = await postComment(recipe.id, COMMENTER, 'the question');
    const reply = await postComment(recipe.id, OWNER, 'the answer', root.body._id);

    expect(reply.status).toBe(201);
    expect(reply.body.parent).toBe(root.body._id);

    const detail = await api().get(`/api/recipes/${recipe.id}`);

    expect(detail.status).toBe(200);
    // Only the root is a top-level entry; the reply hangs off it.
    expect(detail.body.comments).toHaveLength(1);
    expect(detail.body.comments[0].text).toBe('the question');
    expect(detail.body.comments[0].replies).toHaveLength(1);
    expect(detail.body.comments[0].replies[0]).toMatchObject({
      _id: reply.body._id,
      text: 'the answer',
      authorId: OWNER,
    });
  });

  it('counts replies in commentCount', async () => {
    const recipe = await createRecipe({ author: OWNER });
    const root = await postComment(recipe.id, COMMENTER, 'root');
    await postComment(recipe.id, STRANGER, 'reply one', root.body._id);
    await postComment(recipe.id, OWNER, 'reply two', root.body._id);

    expect(await Comment.countDocuments({ recipe: recipe.id })).toBe(3);
    expect(await storedCount(recipe.id)).toBe(3);

    const detail = await api().get(`/api/recipes/${recipe.id}`);
    expect(detail.body.commentCount).toBe(3);
    expect(detail.body.comments[0].replies).toHaveLength(2);

    // And the card in the list view sees the same number.
    const list = await api().get('/api/recipes');
    const card = list.body.items.find((item: { _id: string }) => item._id === recipe.id);
    expect(card.commentCount).toBe(3);
  });

  it('sorts replies oldest-first while roots are newest-first', async () => {
    const recipe = await createRecipe({ author: OWNER });
    const first = await postComment(recipe.id, COMMENTER, 'first root');
    await sleep(15);
    await postComment(recipe.id, COMMENTER, 'second root');

    await postComment(recipe.id, STRANGER, 'early reply', first.body._id);
    await sleep(15);
    await postComment(recipe.id, STRANGER, 'late reply', first.body._id);

    const detail = await api().get(`/api/recipes/${recipe.id}`);

    expect(detail.body.comments.map((c: { text: string }) => c.text)).toEqual([
      'second root',
      'first root',
    ]);
    expect(detail.body.comments[1].replies.map((r: { text: string }) => r.text)).toEqual([
      'early reply',
      'late reply',
    ]);
    expect(detail.body.comments[0].replies).toEqual([]);
  });

  it('refuses to nest a reply more than one level deep', async () => {
    const recipe = await createRecipe({ author: OWNER });
    const root = await postComment(recipe.id, COMMENTER, 'root');
    const reply = await postComment(recipe.id, STRANGER, 'reply', root.body._id);

    const res = await postComment(recipe.id, COMMENTER, 'reply to a reply', reply.body._id);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('bad_request');
    // Nothing was written, and the counter was not touched.
    expect(await Comment.countDocuments({ recipe: recipe.id })).toBe(2);
    expect(await storedCount(recipe.id)).toBe(2);
  });

  it('404s when replying to a comment that belongs to a different recipe', async () => {
    const host = await createRecipe({ author: OWNER });
    const other = await createRecipe({ author: OWNER });
    const elsewhere = await postComment(other.id, COMMENTER, 'over here');

    const res = await postComment(host.id, COMMENTER, 'wrong thread', elsewhere.body._id);

    expect(res.status).toBe(404);
    expect(await Comment.countDocuments({ recipe: host.id })).toBe(0);
  });

  it('404s when replying to a comment that does not exist', async () => {
    const recipe = await createRecipe({ author: OWNER });
    const missing = new mongoose.Types.ObjectId().toString();

    const res = await postComment(recipe.id, COMMENTER, 'ghost thread', missing);

    expect(res.status).toBe(404);
  });

  it('400s for a malformed parent id', async () => {
    const recipe = await createRecipe({ author: OWNER });

    const res = await api()
      .post(`/api/recipes/${recipe.id}/comments`)
      .set(authHeader(COMMENTER))
      .send({ text: 'hi', parent: 'not-an-id' });

    expect(res.status).toBe(400);
  });

  it('deleting a parent deletes its replies and drops the counter by all of them', async () => {
    const recipe = await createRecipe({ author: OWNER });
    const doomed = await postComment(recipe.id, COMMENTER, 'doomed root');
    const replyA = await postComment(recipe.id, STRANGER, 'reply a', doomed.body._id);
    const replyB = await postComment(recipe.id, OWNER, 'reply b', doomed.body._id);
    // A second thread that must survive untouched.
    const survivor = await postComment(recipe.id, COMMENTER, 'other root');
    const survivorReply = await postComment(recipe.id, STRANGER, 'other reply', survivor.body._id);

    expect(await storedCount(recipe.id)).toBe(5);

    const res = await api()
      .delete(`/api/recipes/${recipe.id}/comments/${doomed.body._id}`)
      .set(authHeader(COMMENTER));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, commentCount: 2 });

    // The parent and both of its replies are gone as documents.
    for (const id of [doomed.body._id, replyA.body._id, replyB.body._id]) {
      expect(await Comment.findById(id).lean()).toBeNull();
    }
    expect(await Comment.findById(survivorReply.body._id).lean()).not.toBeNull();

    expect(await Comment.countDocuments({ recipe: recipe.id })).toBe(2);
    expect(await storedCount(recipe.id)).toBe(2);
  });

  it('deleting a reply leaves its parent alone', async () => {
    const recipe = await createRecipe({ author: OWNER });
    const root = await postComment(recipe.id, COMMENTER, 'root');
    const reply = await postComment(recipe.id, STRANGER, 'reply', root.body._id);

    const res = await api()
      .delete(`/api/recipes/${recipe.id}/comments/${reply.body._id}`)
      .set(authHeader(STRANGER));

    expect(res.status).toBe(200);
    expect(await Comment.findById(root.body._id).lean()).not.toBeNull();
    expect(await storedCount(recipe.id)).toBe(1);
  });

  it('the recipe owner can moderate a whole thread they did not write', async () => {
    const recipe = await createRecipe({ author: OWNER });
    const root = await postComment(recipe.id, COMMENTER, 'root');
    await postComment(recipe.id, STRANGER, 'reply', root.body._id);

    const res = await api()
      .delete(`/api/recipes/${recipe.id}/comments/${root.body._id}`)
      .set(authHeader(OWNER));

    expect(res.status).toBe(200);
    expect(await Comment.countDocuments({ recipe: recipe.id })).toBe(0);
  });
});

describe('deleting a recipe takes its comments with it', () => {
  it('leaves no comment document behind', async () => {
    const recipe = await createRecipe({ author: OWNER });
    const root = await postComment(recipe.id, COMMENTER, 'root');
    await postComment(recipe.id, STRANGER, 'reply', root.body._id);
    await postComment(recipe.id, STRANGER, 'another root');

    // A second recipe's thread proves the delete is scoped rather than global.
    const bystander = await createRecipe({ author: OWNER });
    await postComment(bystander.id, COMMENTER, 'untouched');

    expect(await Comment.countDocuments({ recipe: recipe.id })).toBe(3);

    const res = await api().delete(`/api/recipes/${recipe.id}`).set(authHeader(OWNER));

    expect(res.status).toBe(200);
    expect(await Comment.countDocuments({ recipe: recipe.id })).toBe(0);
    expect(await Comment.countDocuments({ recipe: bystander.id })).toBe(1);
  });

  it('a refused delete keeps the thread', async () => {
    const recipe = await createRecipe({ author: OWNER });
    await postComment(recipe.id, COMMENTER, 'still here');

    const res = await api().delete(`/api/recipes/${recipe.id}`).set(authHeader(STRANGER));

    expect(res.status).toBe(403);
    expect(await Comment.countDocuments({ recipe: recipe.id })).toBe(1);
  });
});

describe('SECURITY: no comment response carries an email address', () => {
  it('not on create, detail or edit — including a commenter with no profile', async () => {
    const recipe = await createRecipe({ author: OWNER });

    // No profile for this uid, so the display name is derived from the token.
    const created = await postComment(recipe.id, 'no-profile-uid', 'hello');
    expect(created.status).toBe(201);
    expect(created.body.authorName).toBe('no-profile-uid');
    expect(created.body.authorName).not.toMatch(EMAIL_PATTERN);
    expectNoEmailLeak(created.body);

    const reply = await postComment(recipe.id, 'no-profile-uid', 'replying', created.body._id);
    expectNoEmailLeak(reply.body);

    const detail = await api().get(`/api/recipes/${recipe.id}`);
    expect(detail.body.comments[0].authorName).not.toMatch(EMAIL_PATTERN);
    expectNoEmailLeak(detail.body);

    const edited = await api()
      .patch(`/api/recipes/${recipe.id}/comments/${created.body._id}`)
      .set(authHeader('no-profile-uid'))
      .send({ text: 'edited' });
    expect(edited.status).toBe(200);
    expectNoEmailLeak(edited.body);

    // And nothing email-shaped was stored to leak later either.
    const stored = await storedComments(recipe.id);
    expect(JSON.stringify(stored)).not.toMatch(EMAIL_PATTERN);
  });

  it('a commenter whose token has no email claim is "Anonymous cook"', async () => {
    const recipe = await createRecipe({ author: OWNER });

    const res = await api()
      .post(`/api/recipes/${recipe.id}/comments`)
      .set(authHeader('emailless-uid', ''))
      .send({ text: 'hi' });

    expect(res.status).toBe(201);
    expect(res.body.authorName).toBe('Anonymous cook');
    expectNoEmailLeak(res.body);
  });
});
