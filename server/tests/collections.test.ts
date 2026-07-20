import { describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { Collection } from '../src/models/Collection.js';
import { Recipe } from '../src/models/Recipe.js';
import { LIMITS } from '../src/models/constants.js';
import { api, authHeader, createRecipe, expectNoEmailLeak } from './helpers.js';

const OWNER = 'collection-owner';
const STRANGER = 'collection-stranger';

/** A syntactically valid id that nothing was ever written under. */
const missingId = () => new mongoose.Types.ObjectId().toString();

/** Inserts a collection straight through the model. */
async function seedCollection(fields: Record<string, unknown> = {}) {
  return Collection.create({
    owner: OWNER,
    name: 'Weeknight dinners',
    description: '',
    isPublic: false,
    recipes: [],
    ...fields,
  });
}

describe('POST /api/collections', () => {
  it('creates a collection owned by the caller', async () => {
    const res = await api()
      .post('/api/collections')
      .set(authHeader(OWNER))
      .send({ name: 'Eid', description: 'Once a year', isPublic: true });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: 'Eid',
      description: 'Once a year',
      isPublic: true,
      owner: OWNER,
      recipeCount: 0,
    });
    // The recipe array is never part of the collection envelope.
    expect(res.body.recipes).toBeUndefined();
    expectNoEmailLeak(res.body);
  });

  it('defaults description and visibility', async () => {
    const res = await api().post('/api/collections').set(authHeader(OWNER)).send({ name: 'Untitled' });

    expect(res.status).toBe(201);
    expect(res.body.description).toBe('');
    expect(res.body.isPublic).toBe(false);
  });

  it('can be seeded with recipes, and the count matches', async () => {
    const a = await createRecipe({ author: OWNER });
    const b = await createRecipe({ author: OWNER });

    const res = await api()
      .post('/api/collections')
      .set(authHeader(OWNER))
      .send({ name: 'Seeded', recipes: [a.id, b.id] });

    expect(res.status).toBe(201);
    expect(res.body.recipeCount).toBe(2);
  });

  it('requires authentication', async () => {
    const res = await api().post('/api/collections').send({ name: 'Anonymous' });
    expect(res.status).toBe(401);
  });

  it('rejects an empty name', async () => {
    const res = await api().post('/api/collections').set(authHeader(OWNER)).send({ name: '   ' });
    expect(res.status).toBe(400);
  });

  it('rejects unknown keys', async () => {
    const res = await api()
      .post('/api/collections')
      .set(authHeader(OWNER))
      .send({ name: 'Sneaky', owner: STRANGER });

    expect(res.status).toBe(400);
  });

  it('strips markup from the name and description', async () => {
    const res = await api()
      .post('/api/collections')
      .set(authHeader(OWNER))
      .send({ name: '<b>Bold</b>', description: '<script>alert(1)</script>notes' });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Bold');
    expect(res.body.description).not.toContain('<script>');
  });
});

describe('GET /api/collections', () => {
  it('requires auth for ?owner=me', async () => {
    const res = await api().get('/api/collections?owner=me');
    expect(res.status).toBe(401);
  });

  it('returns the callers own collections including private ones', async () => {
    await seedCollection({ name: 'Private one', isPublic: false });
    await seedCollection({ name: 'Public one', isPublic: true });

    const res = await api().get('/api/collections?owner=me').set(authHeader(OWNER));

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.items.map((c: { name: string }) => c.name).sort()).toEqual(['Private one', 'Public one']);
    expectNoEmailLeak(res.body);
  });

  it('returns only PUBLIC collections when asking for another users uid', async () => {
    await seedCollection({ name: 'Private one', isPublic: false });
    await seedCollection({ name: 'Public one', isPublic: true });

    const res = await api().get(`/api/collections?owner=${OWNER}`).set(authHeader(STRANGER));

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].name).toBe('Public one');
  });

  it('returns only public collections to an anonymous caller', async () => {
    await seedCollection({ name: 'Private one', isPublic: false });
    await seedCollection({ name: 'Public one', isPublic: true });

    const res = await api().get(`/api/collections?owner=${OWNER}`);

    expect(res.status).toBe(200);
    expect(res.body.items.map((c: { name: string }) => c.name)).toEqual(['Public one']);
  });

  it('paginates', async () => {
    for (let i = 0; i < 4; i += 1) {
      await seedCollection({ name: `Collection ${i}` });
    }

    const res = await api().get('/api/collections?owner=me&page=2&limit=3').set(authHeader(OWNER));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ page: 2, limit: 3, total: 4, totalPages: 2 });
    expect(res.body.items).toHaveLength(1);
  });
});

describe('GET /api/collections/:id', () => {
  it('returns a public collection to anyone, with isOwner false', async () => {
    const collection = await seedCollection({ isPublic: true });

    const res = await api().get(`/api/collections/${collection.id}`).set(authHeader(STRANGER));

    expect(res.status).toBe(200);
    expect(res.body.collection).toMatchObject({ name: 'Weeknight dinners', isOwner: false });
    expect(res.body.recipes).toMatchObject({ items: [], total: 0 });
    expectNoEmailLeak(res.body);
  });

  it('marks the owner', async () => {
    const collection = await seedCollection({ isPublic: true });

    const res = await api().get(`/api/collections/${collection.id}`).set(authHeader(OWNER));

    expect(res.body.collection.isOwner).toBe(true);
  });

  it('returns 404 — NOT 403 — for a private collection requested by a non-owner', async () => {
    const collection = await seedCollection({ isPublic: false });

    const asStranger = await api().get(`/api/collections/${collection.id}`).set(authHeader(STRANGER));
    const asAnonymous = await api().get(`/api/collections/${collection.id}`);

    // A 403 would confirm that a collection exists at this id, which is itself
    // the leak. Both callers must be told the same thing as for a bad id.
    expect(asStranger.status).toBe(404);
    expect(asAnonymous.status).toBe(404);
    expect(asStranger.body.error.code).toBe('not_found');

    const unknown = await api().get(`/api/collections/${missingId()}`).set(authHeader(STRANGER));
    expect(unknown.body.error.message).toBe(asStranger.body.error.message);
  });

  it('lets the owner read their own private collection', async () => {
    const collection = await seedCollection({ isPublic: false });

    const res = await api().get(`/api/collections/${collection.id}`).set(authHeader(OWNER));
    expect(res.status).toBe(200);
  });

  it('404s an unknown id and 400s a malformed one', async () => {
    expect((await api().get(`/api/collections/${missingId()}`)).status).toBe(404);
    expect((await api().get('/api/collections/not-an-id')).status).toBe(400);
  });

  it('orders recipes most-recently-added first, despite $in not preserving order', async () => {
    const first = await createRecipe({ author: OWNER, title: 'First added' });
    const second = await createRecipe({ author: OWNER, title: 'Second added' });
    const third = await createRecipe({ author: OWNER, title: 'Third added' });

    // Stored in the order the owner added them; ascending _id order is what a
    // bare `$in` would return, so a reversed expectation proves the restore.
    const collection = await seedCollection({ isPublic: true, recipes: [first._id, second._id, third._id] });

    const res = await api().get(`/api/collections/${collection.id}`).set(authHeader(OWNER));

    expect(res.status).toBe(200);
    expect(res.body.recipes.items.map((r: { title: string }) => r.title)).toEqual([
      'Third added',
      'Second added',
      'First added',
    ]);
  });

  it('paginates the recipes, keeping the newest-first order across pages', async () => {
    const recipes = [];
    for (let i = 0; i < 5; i += 1) {
      recipes.push(await createRecipe({ author: OWNER, title: `R${i}` }));
    }
    const collection = await seedCollection({
      isPublic: true,
      recipes: recipes.map((r) => r._id),
    });

    const page1 = await api().get(`/api/collections/${collection.id}?page=1&limit=2`).set(authHeader(OWNER));
    const page2 = await api().get(`/api/collections/${collection.id}?page=2&limit=2`).set(authHeader(OWNER));

    expect(page1.body.recipes.items.map((r: { title: string }) => r.title)).toEqual(['R4', 'R3']);
    expect(page2.body.recipes.items.map((r: { title: string }) => r.title)).toEqual(['R2', 'R1']);
    expect(page1.body.recipes.total).toBe(5);
  });

  it('counts only recipes that still exist, so a deleted one cannot create a phantom page', async () => {
    const recipes = [];
    for (let i = 0; i < 7; i += 1) {
      recipes.push(await createRecipe({ author: OWNER, title: `R${i}` }));
    }
    const collection = await seedCollection({ isPublic: true, recipes: recipes.map((r) => r._id) });

    // Deleted straight through the model, so the id is deliberately left
    // dangling in the collection — the state the count has to survive.
    await Recipe.deleteOne({ _id: recipes[0]._id });

    const page1 = await api().get(`/api/collections/${collection.id}?page=1&limit=6`).set(authHeader(OWNER));

    expect(page1.body.recipes.total).toBe(6);
    expect(page1.body.recipes.totalPages).toBe(1);

    // The trailing page holds only the dangling id, and must not be advertised.
    const page2 = await api().get(`/api/collections/${collection.id}?page=2&limit=6`).set(authHeader(OWNER));
    expect(page2.body.recipes.items).toEqual([]);
    expect(page2.body.recipes.total).toBe(6);
  });

  it('never leaks an author email through the recipe list', async () => {
    const recipe = await createRecipe({ author: OWNER, authorEmail: 'secret@example.com' });
    const collection = await seedCollection({ isPublic: true, recipes: [recipe._id] });

    const res = await api().get(`/api/collections/${collection.id}`);

    expect(res.body.recipes.items).toHaveLength(1);
    expectNoEmailLeak(res.body);
  });
});

describe('PATCH /api/collections/:id', () => {
  it('updates the owners own collection', async () => {
    const collection = await seedCollection();

    const res = await api()
      .patch(`/api/collections/${collection.id}`)
      .set(authHeader(OWNER))
      .send({ name: 'Renamed', isPublic: true });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: 'Renamed', isPublic: true });
    expectNoEmailLeak(res.body);
  });

  it('leaves omitted fields alone', async () => {
    const collection = await seedCollection({ description: 'Keep me', isPublic: true });

    const res = await api()
      .patch(`/api/collections/${collection.id}`)
      .set(authHeader(OWNER))
      .send({ name: 'Renamed' });

    expect(res.status).toBe(200);
    expect(res.body.description).toBe('Keep me');
    expect(res.body.isPublic).toBe(true);
  });

  it('403s another user, 404s an unknown id and 400s a malformed one', async () => {
    const collection = await seedCollection();

    const other = await api()
      .patch(`/api/collections/${collection.id}`)
      .set(authHeader(STRANGER))
      .send({ name: 'Mine now' });
    expect(other.status).toBe(403);

    const unknown = await api()
      .patch(`/api/collections/${missingId()}`)
      .set(authHeader(OWNER))
      .send({ name: 'Nope' });
    expect(unknown.status).toBe(404);

    const malformed = await api()
      .patch('/api/collections/nope')
      .set(authHeader(OWNER))
      .send({ name: 'Nope' });
    expect(malformed.status).toBe(400);
  });

  it('requires authentication', async () => {
    const collection = await seedCollection();
    const res = await api().patch(`/api/collections/${collection.id}`).send({ name: 'Nope' });
    expect(res.status).toBe(401);
  });

  it('rejects an empty body', async () => {
    const collection = await seedCollection();
    const res = await api().patch(`/api/collections/${collection.id}`).set(authHeader(OWNER)).send({});
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/collections/:id', () => {
  it('deletes the collection', async () => {
    const collection = await seedCollection();

    const res = await api().delete(`/api/collections/${collection.id}`).set(authHeader(OWNER));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(await Collection.findById(collection.id)).toBeNull();
  });

  it('does NOT delete the recipes it contained', async () => {
    const a = await createRecipe({ author: OWNER });
    const b = await createRecipe({ author: OWNER });
    const collection = await seedCollection({ recipes: [a._id, b._id] });

    await api().delete(`/api/collections/${collection.id}`).set(authHeader(OWNER)).expect(200);

    // A collection is a grouping, not ownership.
    expect(await Recipe.countDocuments({ _id: { $in: [a._id, b._id] } })).toBe(2);
  });

  it('403s another user, 404s an unknown id and 400s a malformed one', async () => {
    const collection = await seedCollection();

    expect((await api().delete(`/api/collections/${collection.id}`).set(authHeader(STRANGER))).status).toBe(403);
    expect((await api().delete(`/api/collections/${missingId()}`).set(authHeader(OWNER))).status).toBe(404);
    expect((await api().delete('/api/collections/nope').set(authHeader(OWNER))).status).toBe(400);
    // …and the collection survived every one of those.
    expect(await Collection.findById(collection.id)).not.toBeNull();
  });

  it('requires authentication', async () => {
    const collection = await seedCollection();
    expect((await api().delete(`/api/collections/${collection.id}`)).status).toBe(401);
  });
});

describe('deleting a recipe', () => {
  it('removes it from every collection containing it', async () => {
    const recipe = await createRecipe({ author: OWNER });
    const keeper = await createRecipe({ author: OWNER });

    const one = await seedCollection({ name: 'One', recipes: [recipe._id, keeper._id] });
    const two = await seedCollection({ name: 'Two', recipes: [recipe._id] });
    const three = await Collection.create({ owner: STRANGER, name: 'Someone elses', recipes: [recipe._id] });

    await api().delete(`/api/recipes/${recipe.id}`).set(authHeader(OWNER)).expect(200);

    for (const id of [one.id, two.id, three.id]) {
      const after = await Collection.findById(id).lean();
      expect(after!.recipes.map(String)).not.toContain(recipe.id);
    }
    // The other recipe is untouched.
    expect((await Collection.findById(one.id).lean())!.recipes.map(String)).toEqual([keeper.id]);
  });
});

describe('PUT /api/collections/:id/recipes/:recipeId', () => {
  it('adds, then removes, and is back where it started after two toggles', async () => {
    const recipe = await createRecipe({ author: OWNER });
    const collection = await seedCollection();

    const added = await api()
      .put(`/api/collections/${collection.id}/recipes/${recipe.id}`)
      .set(authHeader(OWNER));

    expect(added.status).toBe(200);
    expect(added.body).toEqual({ added: true, recipeCount: 1, recipeIds: [recipe.id] });

    const removed = await api()
      .put(`/api/collections/${collection.id}/recipes/${recipe.id}`)
      .set(authHeader(OWNER));

    expect(removed.status).toBe(200);
    expect(removed.body).toEqual({ added: false, recipeCount: 0, recipeIds: [] });

    const stored = await Collection.findById(collection.id).lean();
    expect(stored!.recipes).toEqual([]);
    expect(stored!.recipeCount).toBe(0);
  });

  it('keeps recipeCount consistent with the array through a run of toggles', async () => {
    const recipes = [];
    for (let i = 0; i < 3; i += 1) recipes.push(await createRecipe({ author: OWNER }));
    const collection = await seedCollection();

    for (const recipe of recipes) {
      await api().put(`/api/collections/${collection.id}/recipes/${recipe.id}`).set(authHeader(OWNER));
    }
    await api().put(`/api/collections/${collection.id}/recipes/${recipes[1].id}`).set(authHeader(OWNER));

    const stored = await Collection.findById(collection.id).lean();
    expect(stored!.recipes).toHaveLength(2);
    expect(stored!.recipeCount).toBe(stored!.recipes.length);
    expect(stored!.recipes.map(String)).toEqual([recipes[0].id, recipes[2].id]);
  });

  it('is idempotent in effect: adding an already-present recipe never duplicates it', async () => {
    const recipe = await createRecipe({ author: OWNER });
    const collection = await seedCollection({ recipes: [recipe._id] });

    // Toggle out and back in; the array must hold exactly one copy.
    await api().put(`/api/collections/${collection.id}/recipes/${recipe.id}`).set(authHeader(OWNER));
    await api().put(`/api/collections/${collection.id}/recipes/${recipe.id}`).set(authHeader(OWNER));

    const stored = await Collection.findById(collection.id).lean();
    expect(stored!.recipes.map(String)).toEqual([recipe.id]);
    expect(stored!.recipeCount).toBe(1);
  });

  it('404s a recipe that does not exist', async () => {
    const collection = await seedCollection();

    const res = await api()
      .put(`/api/collections/${collection.id}/recipes/${missingId()}`)
      .set(authHeader(OWNER));

    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe('Recipe not found');
  });

  it('403s another user and 404s an unknown collection', async () => {
    const recipe = await createRecipe({ author: OWNER });
    const collection = await seedCollection();

    expect(
      (await api().put(`/api/collections/${collection.id}/recipes/${recipe.id}`).set(authHeader(STRANGER))).status,
    ).toBe(403);
    expect(
      (await api().put(`/api/collections/${missingId()}/recipes/${recipe.id}`).set(authHeader(OWNER))).status,
    ).toBe(404);
  });

  it('400s a malformed id and 401s without a token', async () => {
    const recipe = await createRecipe({ author: OWNER });
    const collection = await seedCollection();

    expect((await api().put(`/api/collections/nope/recipes/${recipe.id}`).set(authHeader(OWNER))).status).toBe(400);
    expect((await api().put(`/api/collections/${collection.id}/recipes/nope`).set(authHeader(OWNER))).status).toBe(400);
    expect((await api().put(`/api/collections/${collection.id}/recipes/${recipe.id}`)).status).toBe(401);
  });
});

describe('limits', () => {
  it(`409s past ${LIMITS.collectionsPerUser} collections per user`, async () => {
    await Collection.insertMany(
      Array.from({ length: LIMITS.collectionsPerUser }, (_unused, i) => ({
        owner: OWNER,
        name: `Collection ${i}`,
      })),
    );

    const res = await api().post('/api/collections').set(authHeader(OWNER)).send({ name: 'One too many' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('conflict');
    expect(await Collection.countDocuments({ owner: OWNER })).toBe(LIMITS.collectionsPerUser);
  });

  it('does not apply another users collections to your allowance', async () => {
    await Collection.insertMany(
      Array.from({ length: LIMITS.collectionsPerUser }, (_unused, i) => ({
        owner: STRANGER,
        name: `Collection ${i}`,
      })),
    );

    const res = await api().post('/api/collections').set(authHeader(OWNER)).send({ name: 'Mine' });
    expect(res.status).toBe(201);
  });

  it(`409s past ${LIMITS.recipesPerCollection} recipes in one collection`, async () => {
    const collection = await seedCollection({
      recipes: Array.from({ length: LIMITS.recipesPerCollection }, () => new mongoose.Types.ObjectId()),
    });
    const recipe = await createRecipe({ author: OWNER });

    const res = await api()
      .put(`/api/collections/${collection.id}/recipes/${recipe.id}`)
      .set(authHeader(OWNER));

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('conflict');

    const stored = await Collection.findById(collection.id).lean();
    expect(stored!.recipes).toHaveLength(LIMITS.recipesPerCollection);
  });

  it('still allows removing a recipe from a full collection', async () => {
    const recipe = await createRecipe({ author: OWNER });
    const collection = await seedCollection({
      recipes: [
        ...Array.from({ length: LIMITS.recipesPerCollection - 1 }, () => new mongoose.Types.ObjectId()),
        recipe._id,
      ],
    });

    const res = await api()
      .put(`/api/collections/${collection.id}/recipes/${recipe.id}`)
      .set(authHeader(OWNER));

    expect(res.status).toBe(200);
    expect(res.body.added).toBe(false);
    expect(res.body.recipeCount).toBe(LIMITS.recipesPerCollection - 1);
  });
});

describe('GET /api/collections/containing/:recipeId', () => {
  it('reports containsRecipe per collection', async () => {
    const recipe = await createRecipe({ author: OWNER });
    const other = await createRecipe({ author: OWNER });

    await seedCollection({ name: 'Has it', recipes: [recipe._id] });
    await seedCollection({ name: 'Does not', recipes: [other._id] });
    await seedCollection({ name: 'Empty' });

    const res = await api().get(`/api/collections/containing/${recipe.id}`).set(authHeader(OWNER));

    expect(res.status).toBe(200);
    const byName = Object.fromEntries(
      res.body.map((c: { name: string; containsRecipe: boolean }) => [c.name, c.containsRecipe]),
    );
    expect(byName).toEqual({ 'Has it': true, 'Does not': false, Empty: false });
    expectNoEmailLeak(res.body);
  });

  it('only ever reports the callers own collections', async () => {
    const recipe = await createRecipe({ author: OWNER });
    await seedCollection({ name: 'Mine', recipes: [recipe._id] });
    await Collection.create({ owner: STRANGER, name: 'Theirs', recipes: [recipe._id] });

    const res = await api().get(`/api/collections/containing/${recipe.id}`).set(authHeader(STRANGER));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('Theirs');
  });

  it('requires auth', async () => {
    const recipe = await createRecipe({ author: OWNER });
    expect((await api().get(`/api/collections/containing/${recipe.id}`)).status).toBe(401);
  });

  it('400s a malformed recipe id', async () => {
    expect((await api().get('/api/collections/containing/nope').set(authHeader(OWNER))).status).toBe(400);
  });

  it('returns an empty array when the caller has no collections', async () => {
    const recipe = await createRecipe({ author: OWNER });
    const res = await api().get(`/api/collections/containing/${recipe.id}`).set(authHeader(STRANGER));
    expect(res.body).toEqual([]);
  });
});
