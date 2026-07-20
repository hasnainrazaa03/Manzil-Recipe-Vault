import { describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { Recipe } from '../src/models/Recipe.js';
import { RecipeVersion, MAX_VERSIONS_PER_RECIPE } from '../src/models/RecipeVersion.js';
import { api, authHeader, createRecipe, recipePayload } from './helpers.js';

const AUTHOR = 'version-author';
const STRANGER = 'version-stranger';

const missingId = () => new mongoose.Types.ObjectId().toString();

/** Creates a recipe through the API, so it starts with no history at all. */
async function createViaApi(overrides: Record<string, unknown> = {}) {
  const res = await api()
    .post('/api/recipes')
    .set(authHeader(AUTHOR))
    .send(recipePayload({ title: 'Original title', ...overrides }));

  expect(res.status).toBe(201);
  return res.body as { _id: string; title: string };
}

const update = (id: string, body: Record<string, unknown>, uid = AUTHOR) =>
  api().put(`/api/recipes/${id}`).set(authHeader(uid)).send(body);

const listVersions = (id: string, uid = AUTHOR) =>
  api().get(`/api/recipes/${id}/versions`).set(authHeader(uid));

describe('version history is written on update', () => {
  it('writes no version when a recipe is created', async () => {
    const recipe = await createViaApi();

    expect(await RecipeVersion.countDocuments({ recipe: recipe._id })).toBe(0);
    expect((await listVersions(recipe._id)).body).toEqual([]);
  });

  it('writes one version per update', async () => {
    const recipe = await createViaApi();

    await update(recipe._id, { title: 'Second' }).expect(200);
    await update(recipe._id, { title: 'Third' }).expect(200);

    expect(await RecipeVersion.countDocuments({ recipe: recipe._id })).toBe(2);
  });

  it('snapshots the state BEFORE the edit', async () => {
    const recipe = await createViaApi({ title: 'Original title', overview: 'Original overview' });

    await update(recipe._id, { title: 'Edited title' }).expect(200);

    const version = await RecipeVersion.findOne({ recipe: recipe._id, version: 1 }).lean();
    expect(version!.snapshot!.title).toBe('Original title');
    expect(version!.snapshot!.overview).toBe('Original overview');

    // …and the recipe itself moved on.
    expect((await Recipe.findById(recipe._id).lean())!.title).toBe('Edited title');
  });

  it('records who made the edit, and no restoredFrom for an ordinary edit', async () => {
    const recipe = await createViaApi();
    await update(recipe._id, { title: 'Edited' }).expect(200);

    const version = await RecipeVersion.findOne({ recipe: recipe._id, version: 1 }).lean();
    expect(version!.editedBy).toBe(AUTHOR);
    expect(version!.restoredFrom).toBeNull();
  });

  it('numbers versions monotonically from 1', async () => {
    const recipe = await createViaApi();

    for (let i = 0; i < 4; i += 1) {
      await update(recipe._id, { title: `Edit ${i}` }).expect(200);
    }

    const versions = await RecipeVersion.find({ recipe: recipe._id }).sort({ version: 1 }).lean();
    expect(versions.map((v) => v.version)).toEqual([1, 2, 3, 4]);
  });

  it('lists the history newest first, with only a summary of each snapshot', async () => {
    const recipe = await createViaApi({ title: 'V1' });
    await update(recipe._id, { title: 'V2' }).expect(200);
    await update(recipe._id, { title: 'V3' }).expect(200);

    const res = await listVersions(recipe._id);

    expect(res.status).toBe(200);
    expect(res.body.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    expect(res.body.map((v: { snapshot: { title: string } }) => v.snapshot.title)).toEqual(['V2', 'V1']);
    // The list projection carries the title only, not the whole snapshot.
    expect(Object.keys(res.body[0].snapshot)).toEqual(['title']);
  });
});

describe('history is capped', () => {
  it(`keeps only the newest ${MAX_VERSIONS_PER_RECIPE} versions and does not restart numbering`, async () => {
    const recipe = await createViaApi();

    const edits = MAX_VERSIONS_PER_RECIPE + 5;
    for (let i = 1; i <= edits; i += 1) {
      await update(recipe._id, { title: `Edit ${i}` }).expect(200);
    }

    const versions = await RecipeVersion.find({ recipe: recipe._id }).sort({ version: 1 }).lean();

    expect(versions).toHaveLength(MAX_VERSIONS_PER_RECIPE);
    // The oldest were discarded; numbering carried straight on rather than
    // wrapping back to 1 and colliding with a version that still exists.
    expect(versions[0].version).toBe(edits - MAX_VERSIONS_PER_RECIPE + 1);
    expect(versions[versions.length - 1].version).toBe(edits);
    expect(versions.map((v) => v.version)).toEqual(
      Array.from({ length: MAX_VERSIONS_PER_RECIPE }, (_unused, i) => edits - MAX_VERSIONS_PER_RECIPE + 1 + i),
    );
  });

  it('404s a version that has aged out of the history', async () => {
    const recipe = await createViaApi();
    for (let i = 1; i <= MAX_VERSIONS_PER_RECIPE + 2; i += 1) {
      await update(recipe._id, { title: `Edit ${i}` }).expect(200);
    }

    const res = await api().get(`/api/recipes/${recipe._id}/versions/1`).set(authHeader(AUTHOR));
    expect(res.status).toBe(404);
  });
});

describe('only the author can use the history', () => {
  it('403s another user listing, reading or restoring', async () => {
    const recipe = await createViaApi();
    await update(recipe._id, { title: 'Edited' }).expect(200);

    expect((await listVersions(recipe._id, STRANGER)).status).toBe(403);
    expect((await api().get(`/api/recipes/${recipe._id}/versions/1`).set(authHeader(STRANGER))).status).toBe(403);
    expect(
      (await api().post(`/api/recipes/${recipe._id}/versions/1/restore`).set(authHeader(STRANGER))).status,
    ).toBe(403);

    // Nothing changed as a result of any of that.
    expect((await Recipe.findById(recipe._id).lean())!.title).toBe('Edited');
    expect(await RecipeVersion.countDocuments({ recipe: recipe._id })).toBe(1);
  });

  it('401s an anonymous caller', async () => {
    const recipe = await createViaApi();
    await update(recipe._id, { title: 'Edited' }).expect(200);

    expect((await api().get(`/api/recipes/${recipe._id}/versions`)).status).toBe(401);
    expect((await api().get(`/api/recipes/${recipe._id}/versions/1`)).status).toBe(401);
    expect((await api().post(`/api/recipes/${recipe._id}/versions/1/restore`)).status).toBe(401);
  });

  it('404s an unknown recipe and 400s a malformed id', async () => {
    expect((await listVersions(missingId())).status).toBe(404);
    expect((await api().get('/api/recipes/nope/versions').set(authHeader(AUTHOR))).status).toBe(400);
    expect((await api().get(`/api/recipes/${missingId()}/versions/1`).set(authHeader(AUTHOR))).status).toBe(404);
  });
});

describe('GET /api/recipes/:id/versions/:version', () => {
  it('returns the full snapshot', async () => {
    const recipe = await createViaApi({
      title: 'Original title',
      overview: 'Original overview',
      ingredients: [{ amount: '2', name: 'eggs' }],
      servings: 4,
      cuisine: 'Pakistani',
    });
    await update(recipe._id, { title: 'Changed' }).expect(200);

    const res = await api().get(`/api/recipes/${recipe._id}/versions/1`).set(authHeader(AUTHOR));

    expect(res.status).toBe(200);
    expect(res.body.version).toBe(1);
    expect(res.body.snapshot).toMatchObject({
      title: 'Original title',
      overview: 'Original overview',
      servings: 4,
      cuisine: 'Pakistani',
    });
    expect(res.body.snapshot.ingredients).toEqual([{ amount: '2', name: 'eggs' }]);
  });

  it('404s a version number that was never written', async () => {
    const recipe = await createViaApi();
    await update(recipe._id, { title: 'Edited' }).expect(200);

    const res = await api().get(`/api/recipes/${recipe._id}/versions/99`).set(authHeader(AUTHOR));

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });

  it('400s a non-numeric or zero version', async () => {
    const recipe = await createViaApi();

    expect((await api().get(`/api/recipes/${recipe._id}/versions/abc`).set(authHeader(AUTHOR))).status).toBe(400);
    expect((await api().get(`/api/recipes/${recipe._id}/versions/0`).set(authHeader(AUTHOR))).status).toBe(400);
  });

  it('snapshots only the writable fields — never ratings, comments or the author', async () => {
    // Arranged directly so the recipe carries the things a snapshot must not.
    const recipe = await createRecipe({
      author: AUTHOR,
      title: 'Rated and discussed',
      ratings: [
        { userId: 'r1', score: 5 },
        { userId: 'r2', score: 3 },
      ],
      commentCount: 7,
    });

    await update(recipe.id, { title: 'Edited' }).expect(200);

    const stored = await RecipeVersion.findOne({ recipe: recipe._id, version: 1 }).lean();
    const snapshot = stored!.snapshot as Record<string, unknown>;

    for (const field of ['ratings', 'comments', 'averageRating', 'ratingCount', 'author', 'authorEmail', 'authorName', 'commentCount']) {
      expect(Object.keys(snapshot)).not.toContain(field);
    }

    expect(Object.keys(snapshot).sort()).toEqual(
      [
        'cookMinutes',
        'cuisine',
        'difficulty',
        'image',
        'ingredients',
        'instructions',
        'overview',
        'prepMinutes',
        'servings',
        'tags',
        'title',
      ].sort(),
    );

    // Belt and braces: nothing anywhere in the served body either.
    const res = await api().get(`/api/recipes/${recipe.id}/versions/1`).set(authHeader(AUTHOR));
    expect(res.body.snapshot.ratings).toBeUndefined();
    expect(res.body.snapshot.author).toBeUndefined();
  });
});

describe('POST /api/recipes/:id/versions/:version/restore', () => {
  it('applies the old content', async () => {
    const recipe = await createViaApi({ title: 'Original title', overview: 'Original overview' });
    await update(recipe._id, { title: 'Bad edit', overview: 'Bad overview' }).expect(200);

    const res = await api().post(`/api/recipes/${recipe._id}/versions/1/restore`).set(authHeader(AUTHOR));

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Original title');
    expect(res.body.overview).toBe('Original overview');

    const stored = await Recipe.findById(recipe._id).lean();
    expect(stored!.title).toBe('Original title');
  });

  it('writes a new version recording what it replaced, with restoredFrom set', async () => {
    const recipe = await createViaApi({ title: 'Original title' });
    await update(recipe._id, { title: 'Bad edit' }).expect(200);

    await api().post(`/api/recipes/${recipe._id}/versions/1/restore`).set(authHeader(AUTHOR)).expect(200);

    const versions = await RecipeVersion.find({ recipe: recipe._id }).sort({ version: 1 }).lean();
    expect(versions.map((v) => v.version)).toEqual([1, 2]);

    // Version 2 holds the state the restore overwrote, so the restore is undoable.
    expect(versions[1].restoredFrom).toBe(1);
    expect(versions[1].snapshot!.title).toBe('Bad edit');
    expect(versions[1].editedBy).toBe(AUTHOR);
  });

  it('restoring twice gets you back to where you started', async () => {
    const recipe = await createViaApi({ title: 'Version A' });
    await update(recipe._id, { title: 'Version B' }).expect(200);

    // The state before the first restore.
    expect((await Recipe.findById(recipe._id).lean())!.title).toBe('Version B');

    // Undo: back to A, and B is snapshotted as version 2.
    const first = await api()
      .post(`/api/recipes/${recipe._id}/versions/1/restore`)
      .set(authHeader(AUTHOR));
    expect(first.body.title).toBe('Version A');

    // Undo the undo.
    const second = await api()
      .post(`/api/recipes/${recipe._id}/versions/2/restore`)
      .set(authHeader(AUTHOR));
    expect(second.status).toBe(200);
    expect(second.body.title).toBe('Version B');

    expect((await Recipe.findById(recipe._id).lean())!.title).toBe('Version B');

    const versions = await RecipeVersion.find({ recipe: recipe._id }).sort({ version: 1 }).lean();
    expect(versions.map((v) => v.version)).toEqual([1, 2, 3]);
    expect(versions.map((v) => v.restoredFrom)).toEqual([null, 1, 2]);
  });

  it('does not touch ratings or comment counts', async () => {
    const recipe = await createRecipe({
      author: AUTHOR,
      title: 'Original title',
      ratings: [{ userId: 'r1', score: 4 }],
      commentCount: 3,
    });
    await update(recipe.id, { title: 'Edited' }).expect(200);

    await api().post(`/api/recipes/${recipe.id}/versions/1/restore`).set(authHeader(AUTHOR)).expect(200);

    const stored = await Recipe.findById(recipe.id).lean();
    expect(stored!.title).toBe('Original title');
    expect(stored!.ratingCount).toBe(1);
    expect(stored!.averageRating).toBe(4);
    expect(stored!.commentCount).toBe(3);
    expect(stored!.author).toBe(AUTHOR);
  });

  it('404s a version that does not exist', async () => {
    const recipe = await createViaApi();
    await update(recipe._id, { title: 'Edited' }).expect(200);

    const res = await api().post(`/api/recipes/${recipe._id}/versions/42/restore`).set(authHeader(AUTHOR));

    expect(res.status).toBe(404);
    expect((await Recipe.findById(recipe._id).lean())!.title).toBe('Edited');
    expect(await RecipeVersion.countDocuments({ recipe: recipe._id })).toBe(1);
  });

  it('404s an unknown recipe', async () => {
    const res = await api().post(`/api/recipes/${missingId()}/versions/1/restore`).set(authHeader(AUTHOR));
    expect(res.status).toBe(404);
  });
});

describe('deleting a recipe', () => {
  it('deletes its versions', async () => {
    const recipe = await createViaApi();
    await update(recipe._id, { title: 'Edit 1' }).expect(200);
    await update(recipe._id, { title: 'Edit 2' }).expect(200);

    expect(await RecipeVersion.countDocuments({ recipe: recipe._id })).toBe(2);

    await api().delete(`/api/recipes/${recipe._id}`).set(authHeader(AUTHOR)).expect(200);

    expect(await RecipeVersion.countDocuments({ recipe: recipe._id })).toBe(0);
  });

  it('leaves another recipes versions alone', async () => {
    const doomed = await createViaApi();
    const survivor = await createViaApi();
    await update(doomed._id, { title: 'Edit' }).expect(200);
    await update(survivor._id, { title: 'Edit' }).expect(200);

    await api().delete(`/api/recipes/${doomed._id}`).set(authHeader(AUTHOR)).expect(200);

    expect(await RecipeVersion.countDocuments({ recipe: survivor._id })).toBe(1);
  });
});
