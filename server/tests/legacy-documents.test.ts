import { describe, expect, it, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { Recipe } from '../src/models/Recipe.js';
import { Profile } from '../src/models/Profile.js';
import { api, authHeader } from './helpers.js';

/**
 * Documents written before the current schema existed.
 *
 * Every list query uses `.lean()`, which skips hydration — so Mongoose defaults
 * never apply and a field added later simply arrives absent. The published
 * response types promise `commentCount: number` and `cuisine: string`, so
 * without normalisation the client receives `undefined` where its types say
 * otherwise, and `recipe.commentCount > 0` is quietly false on every old recipe.
 *
 * These are inserted through the raw driver precisely so that no Mongoose
 * default can paper over the gap.
 */

const LEGACY_AUTHOR = 'legacy-uid';

async function insertLegacyRecipe(overrides: Record<string, unknown> = {}) {
  const doc = {
    title: 'Legacy Recipe',
    image: '',
    overview: 'Written before the metadata fields existed.',
    ingredients: [{ amount: '1 cup', name: 'flour' }],
    instructions: '<p>Mix it.</p>',
    author: LEGACY_AUTHOR,
    authorEmail: 'legacy@example.com',
    tags: ['legacy'],
    ratings: [{ userId: 'someone', score: 4 }],
    averageRating: 4,
    ratingCount: 1,
    comments: [
      {
        _id: new mongoose.Types.ObjectId(),
        text: 'first comment',
        authorId: 'someone',
        authorEmail: 'someone@example.com',
        createdAt: new Date(),
      },
      {
        _id: new mongoose.Types.ObjectId(),
        text: 'second comment',
        authorId: 'another',
        authorEmail: 'another@example.com',
        createdAt: new Date(),
      },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
    // Deliberately absent: authorName, commentCount, servings, prepMinutes,
    // cookMinutes, totalMinutes, difficulty, cuisine.
    ...overrides,
  };

  const result = await mongoose.connection.collection('recipes').insertOne(doc);
  return result.insertedId.toString();
}

describe('legacy documents', () => {
  let legacyId: string;

  beforeEach(async () => {
    legacyId = await insertLegacyRecipe();
  });

  it('the raw document really is missing the newer fields', async () => {
    // Guards the premise of every other test here: if a future change starts
    // writing these fields on insert, these tests would silently stop testing
    // anything.
    const raw = await mongoose.connection.collection('recipes').findOne({ _id: new mongoose.Types.ObjectId(legacyId) });

    expect(raw).not.toBeNull();
    for (const field of ['authorName', 'commentCount', 'servings', 'totalMinutes', 'difficulty', 'cuisine']) {
      expect(raw).not.toHaveProperty(field);
    }
  });

  it('the list endpoint honours the published contract', async () => {
    const res = await api().get('/api/recipes');
    const recipe = res.body.items.find((item: { _id: string }) => item._id === legacyId);

    expect(recipe).toBeDefined();
    expect(recipe.authorName).toBe('Anonymous cook');
    expect(recipe.commentCount).toBe(0);
    expect(recipe.cuisine).toBe('');
    expect(recipe.tags).toEqual(['legacy']);

    // `null` rather than `undefined` — "not stated" has to be representable,
    // and has to survive JSON, which drops undefined keys entirely.
    for (const field of ['servings', 'prepMinutes', 'cookMinutes', 'totalMinutes', 'difficulty']) {
      expect(recipe[field]).toBeNull();
    }
  });

  it('never returns undefined for a field the response type declares', async () => {
    const res = await api().get('/api/recipes');
    const recipe = res.body.items.find((item: { _id: string }) => item._id === legacyId);

    for (const field of ['authorName', 'commentCount', 'ratingCount', 'averageRating', 'cuisine', 'tags', 'image']) {
      expect(recipe[field], `${field} must not be undefined`).toBeDefined();
    }
  });

  it('the detail endpoint counts the comments it actually has', async () => {
    // The detail endpoint does load the comments, so unlike the list it can
    // derive the real count without the migration having run.
    const res = await api().get(`/api/recipes/${legacyId}`);

    expect(res.status).toBe(200);
    expect(res.body.commentCount).toBe(2);
    expect(res.body.comments).toHaveLength(2);
  });

  it('leaks no email address from a legacy document', async () => {
    // These documents predate the email-privacy work, and their comment
    // subdocuments still carry stored addresses.
    for (const path of [`/api/recipes`, `/api/recipes/${legacyId}`, `/api/recipes/${legacyId}/comments`]) {
      const res = await api().get(path);
      expect(JSON.stringify(res.body), `leak via ${path}`).not.toMatch(/@example\.com/);
    }
  });

  it('is excluded from time filters rather than treated as instant', async () => {
    const res = await api().get('/api/recipes?maxMinutes=600');
    const ids = res.body.items.map((item: { _id: string }) => item._id);

    expect(ids).not.toContain(legacyId);
  });

  it('does not head a quickest-first list', async () => {
    await Recipe.create({
      title: 'Timed', overview: 'x', instructions: '<p>x</p>',
      ingredients: [{ amount: '', name: 'x' }],
      author: 'a', authorEmail: 'a@example.com', prepMinutes: 5, cookMinutes: 5,
    });

    const res = await api().get('/api/recipes?sort=quickest');
    const ids = res.body.items.map((item: { _id: string }) => item._id);

    expect(ids).not.toContain(legacyId);
  });

  it('can still be edited, and gains the new fields on save', async () => {
    const res = await api()
      .put(`/api/recipes/${legacyId}`)
      .set(authHeader(LEGACY_AUTHOR, 'legacy@example.com'))
      .send({ servings: 4, prepMinutes: 10, cookMinutes: 20 });

    expect(res.status).toBe(200);
    expect(res.body.totalMinutes).toBe(30);

    const stored = await Recipe.findById(legacyId).lean();
    expect(stored?.totalMinutes).toBe(30);
  });

  it('a legacy profile with no savedRecipes array still works', async () => {
    await mongoose.connection.collection('profiles').insertOne({
      user: 'legacy-profile-uid',
      displayName: 'Old User',
      // No bio, profilePictureUrl or savedRecipes.
    });

    const me = await api().get('/api/users/me').set(authHeader('legacy-profile-uid', 'old@example.com'));
    expect(me.status).toBe(200);
    expect(me.body.savedRecipeIds).toEqual([]);

    const saved = await api()
      .get('/api/users/me/saved-recipes')
      .set(authHeader('legacy-profile-uid', 'old@example.com'));
    expect(saved.status).toBe(200);
    expect(saved.body.items).toEqual([]);
  });

  it('a public profile built from legacy recipes reports a sane name', async () => {
    await Profile.deleteMany({ user: LEGACY_AUTHOR });

    const res = await api().get(`/api/users/${LEGACY_AUTHOR}/profile`);

    expect(res.status).toBe(200);
    expect(res.body.user.displayName).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toMatch(/@example\.com/);
  });
});
