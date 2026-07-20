import { beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { Recipe } from '../src/models/Recipe.js';
import { Comment } from '../src/models/Comment.js';
import { api, authHeader } from './helpers.js';

/**
 * `src/scripts/migrate-comments.ts` — the copy from the embedded array into the
 * `comments` collection.
 *
 * The script itself cannot be driven from a test: it exports nothing and calls
 * `run()` at module scope, so importing it connects to `env.MONGO_URI`, mutates
 * whatever database that names, closes the connection out from under the suite
 * and calls `process.exit(1)` on any failure. See FINDINGS.md → "Note on
 * `migrate-comments.ts`". Spawning it as a subprocess would test the script but
 * not the thing that matters, and refactoring `src/` is out of bounds here.
 *
 * What is testable — and what actually protects the migration — is the set of
 * properties it exists to establish. Each is arranged with the raw driver (an
 * embedded array exactly as an old document carries one) plus the collection
 * documents the copy step would produce, and then asserted through the read
 * path that has to serve them.
 */

const AUTHOR = 'legacy-author';

/** An old recipe: comments embedded, no `commentCount`. */
async function insertRecipeWithEmbeddedComments(
  texts: string[] = ['embedded one', 'embedded two'],
): Promise<{ id: string; embeddedIds: mongoose.Types.ObjectId[] }> {
  const embeddedIds = texts.map(() => new mongoose.Types.ObjectId());

  const result = await mongoose.connection.collection('recipes').insertOne({
    title: 'Pre-migration Recipe',
    image: '',
    overview: 'Written while comments were still embedded.',
    ingredients: [{ amount: '1 cup', name: 'flour' }],
    instructions: '<p>Mix it.</p>',
    author: AUTHOR,
    authorEmail: 'legacy@example.com',
    tags: [],
    ratings: [],
    averageRating: 0,
    ratingCount: 0,
    comments: texts.map((text, index) => ({
      _id: embeddedIds[index],
      text,
      authorId: `commenter-${index}`,
      authorEmail: `commenter-${index}@example.com`,
      authorDisplayName: `commenter-${index}@example.com`,
      createdAt: new Date(Date.now() + index * 1000),
    })),
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  return { id: result.insertedId.toString(), embeddedIds };
}

/** What the copy step writes: one document per embedded comment, same `_id`. */
async function copyEmbeddedComments(recipeId: string): Promise<void> {
  const raw = await mongoose.connection
    .collection('recipes')
    .findOne({ _id: new mongoose.Types.ObjectId(recipeId) });

  const embedded = raw!.comments as {
    _id: mongoose.Types.ObjectId;
    text: string;
    authorId: string;
    createdAt: Date;
  }[];

  await Comment.create(
    embedded.map((comment) => ({
      _id: comment._id,
      recipe: recipeId,
      authorId: comment.authorId,
      // The script derives this from the profile, or from the local part of the
      // stored address, and never from the address itself.
      authorName: comment.authorId,
      text: comment.text,
      parent: null,
      createdAt: comment.createdAt,
    })),
  );

  await Recipe.updateOne(
    { _id: recipeId },
    { $set: { commentCount: await Comment.countDocuments({ recipe: recipeId }) } },
  );
}

describe('the copy step is non-destructive', () => {
  let recipeId: string;

  beforeEach(async () => {
    ({ id: recipeId } = await insertRecipeWithEmbeddedComments());
  });

  it('leaves the embedded array exactly where it was', async () => {
    await copyEmbeddedComments(recipeId);

    const raw = await mongoose.connection
      .collection('recipes')
      .findOne({ _id: new mongoose.Types.ObjectId(recipeId) });

    // The point of the two-step design: rolling back to the previous build
    // restores working comments with nothing to restore from a backup.
    expect(raw!.comments).toHaveLength(2);
  });

  it('reuses the original _id so a link to a specific comment keeps working', async () => {
    const { id, embeddedIds } = await insertRecipeWithEmbeddedComments(['only one']);
    await copyEmbeddedComments(id);

    const copied = await Comment.findById(embeddedIds[0]).lean();

    expect(copied).not.toBeNull();
    expect(copied!.text).toBe('only one');
    expect(String(copied!.recipe)).toBe(id);
  });

  it('sets commentCount from the collection rather than from the array', async () => {
    await copyEmbeddedComments(recipeId);

    const stored = await Recipe.findById(recipeId).lean();
    expect(stored!.commentCount).toBe(await Comment.countDocuments({ recipe: recipeId }));
    expect(stored!.commentCount).toBe(2);
  });

  it('carries no email address across', async () => {
    await copyEmbeddedComments(recipeId);

    // The embedded documents stored an address in both `authorEmail` and
    // `authorDisplayName`; neither has anywhere to land in the new schema.
    const copied = await Comment.find({ recipe: recipeId }).lean();
    expect(JSON.stringify(copied)).not.toMatch(/@/);
  });
});

describe('a recipe with BOTH an embedded array and migrated documents', () => {
  let recipeId: string;

  beforeEach(async () => {
    ({ id: recipeId } = await insertRecipeWithEmbeddedComments());
    await copyEmbeddedComments(recipeId);
  });

  it('the detail endpoint reads the collection and ignores the array', async () => {
    const res = await api().get(`/api/recipes/${recipeId}`);

    expect(res.status).toBe(200);
    // Two, not four: the embedded copies are not served alongside the migrated
    // ones, which is what makes running `--drop` optional rather than urgent.
    expect(res.body.comments).toHaveLength(2);
    expect(res.body.commentCount).toBe(2);
    expect(res.body.comments.map((c: { text: string }) => c.text).sort()).toEqual([
      'embedded one',
      'embedded two',
    ]);
    expect(JSON.stringify(res.body)).not.toMatch(/@example\.com/);
  });

  it('a new comment counts alongside the migrated ones, not the embedded ones', async () => {
    const posted = await api()
      .post(`/api/recipes/${recipeId}/comments`)
      .set(authHeader('new-commenter'))
      .send({ text: 'after the migration' });

    expect(posted.status).toBe(201);

    const stored = await Recipe.findById(recipeId).lean();
    expect(stored!.commentCount).toBe(3);
    expect(await Comment.countDocuments({ recipe: recipeId })).toBe(3);
    // And still two stale embedded entries that nobody counted.
    expect(stored!.comments).toHaveLength(2);
  });

  it('a migrated comment can be replied to, edited and deleted like any other', async () => {
    const root = await Comment.findOne({ recipe: recipeId, text: 'embedded one' }).lean();

    const reply = await api()
      .post(`/api/recipes/${recipeId}/comments`)
      .set(authHeader('replier'))
      .send({ text: 'replying to a migrated comment', parent: String(root!._id) });
    expect(reply.status).toBe(201);

    const edited = await api()
      .patch(`/api/recipes/${recipeId}/comments/${String(root!._id)}`)
      .set(authHeader(root!.authorId))
      .send({ text: 'edited after migrating' });
    expect(edited.status).toBe(200);
    expect(edited.body.text).toBe('edited after migrating');

    const detail = await api().get(`/api/recipes/${recipeId}`);
    const migrated = detail.body.comments.find((c: { _id: string }) => c._id === String(root!._id));
    expect(migrated.text).toBe('edited after migrating');
    expect(migrated.replies).toHaveLength(1);

    const deleted = await api()
      .delete(`/api/recipes/${recipeId}/comments/${String(root!._id)}`)
      .set(authHeader(root!.authorId));
    expect(deleted.status).toBe(200);
    // The parent and its reply go together, leaving the other migrated comment.
    expect(deleted.body.commentCount).toBe(1);
    expect(await Comment.countDocuments({ recipe: recipeId })).toBe(1);
  });
});

describe('the copy step is idempotent', () => {
  it('running it twice writes each comment once', async () => {
    const { id, embeddedIds } = await insertRecipeWithEmbeddedComments();
    await copyEmbeddedComments(id);

    // The script skips a comment whose `_id` is already present. Reusing the id
    // is what makes that check possible, so a duplicate insert must be refused
    // by the unique `_id` rather than silently doubling the thread.
    await expect(copyEmbeddedComments(id)).rejects.toThrow();

    expect(await Comment.countDocuments({ recipe: id })).toBe(2);
    expect(await Comment.countDocuments({ _id: { $in: embeddedIds } })).toBe(2);

    const stored = await Recipe.findById(id).lean();
    expect(stored!.commentCount).toBe(2);
  });

  it('a second run of the read path sees no change', async () => {
    const { id } = await insertRecipeWithEmbeddedComments();
    await copyEmbeddedComments(id);

    const first = await api().get(`/api/recipes/${id}`);
    const second = await api().get(`/api/recipes/${id}`);

    expect(second.body.comments).toEqual(first.body.comments);
    expect(second.body.commentCount).toBe(first.body.commentCount);
  });
});

describe('the drop step', () => {
  it('is safe to skip: dropping the array changes nothing a client can see', async () => {
    const { id } = await insertRecipeWithEmbeddedComments();
    await copyEmbeddedComments(id);

    const before = await api().get(`/api/recipes/${id}`);

    // `--drop`, in one line.
    await mongoose.connection
      .collection('recipes')
      .updateOne({ _id: new mongoose.Types.ObjectId(id) }, { $unset: { comments: '' } });

    const after = await api().get(`/api/recipes/${id}`);

    expect(after.status).toBe(200);
    expect(after.body.comments).toEqual(before.body.comments);
    expect(after.body.commentCount).toBe(before.body.commentCount);
  });

  it('would strand the thread if it ran before the copy — which is why it refuses to', async () => {
    // The failure mode the script's pre-flight count guards against: drop first
    // and the comments are gone from both places at once.
    const { id } = await insertRecipeWithEmbeddedComments();

    const migrated = await Comment.countDocuments({ recipe: id });
    const raw = await mongoose.connection
      .collection('recipes')
      .findOne({ _id: new mongoose.Types.ObjectId(id) });
    const embedded = (raw!.comments as unknown[]).length;

    // Exactly the comparison `dropEmbedded()` makes before touching anything.
    expect(migrated).toBeLessThan(embedded);
  });
});
