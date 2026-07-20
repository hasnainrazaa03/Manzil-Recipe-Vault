import { describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { Profile } from '../src/models/Profile.js';
import { Recipe } from '../src/models/Recipe.js';
import { Comment } from '../src/models/Comment.js';
import { EMAIL_PATTERN, api, authHeader, createProfile, createRecipe, expectNoEmailLeak } from './helpers.js';

const ME = 'me-uid';
const TARGET = 'target-uid';
const TARGET_EMAIL = 'target-uid@example.com';

describe('SECURITY: GET /api/users/:userId/profile does not leak email or private data', () => {
  it('an anonymous caller sees no email address for a user with a profile', async () => {
    await createProfile(TARGET, { displayName: 'Target Cook', bio: 'I cook' });

    const res = await api().get(`/api/users/${TARGET}/profile`);

    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(TARGET_EMAIL);
    expect(body).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
    expect(body).not.toContain('savedRecipes');
    expect(body).not.toContain('savedRecipeIds');
  });

  it('an anonymous caller sees no email even when the user has recipes', async () => {
    await createProfile(TARGET, { displayName: 'Target Cook' });
    await createRecipe({ author: TARGET, authorEmail: TARGET_EMAIL, authorName: 'Target Cook' });

    const res = await api().get(`/api/users/${TARGET}/profile`);

    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(TARGET_EMAIL);
    expect(body).not.toMatch(EMAIL_PATTERN);
    expectNoEmailLeak(res.body);
    // The denormalised display name is what replaced it.
    expect(res.body.recipes.items[0].authorName).toBe('Target Cook');
  });

  it('does not fall back to the Firebase email when there is no display name', async () => {
    // The Firebase stub returns an email but a null displayName; the route must
    // use its own placeholder rather than the address.
    await createRecipe({ author: TARGET });

    const res = await api().get(`/api/users/${TARGET}/profile`);

    expect(res.status).toBe(200);
    expect(res.body.user.displayName).toBe('Anonymous cook');
    expect(res.body.user.displayName).not.toContain('@');
    expect(res.body.user).not.toHaveProperty('email');
  });

  it('never returns the target user’s saved recipes, even to a signed-in caller', async () => {
    const saved = await createRecipe({ author: 'someone-else' });
    await createProfile(TARGET, { displayName: 'Target Cook', savedRecipes: [saved._id] });

    const res = await api().get(`/api/users/${TARGET}/profile`).set(authHeader(ME));

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('savedRecipes');
    expect(res.body.user.isOwner).toBe(false);
  });

  it('returns the public shape: display name, bio, recipe count and a recipe page', async () => {
    await createProfile(TARGET, { displayName: 'Target Cook', bio: 'Bio here' });
    await createRecipe({ author: TARGET });
    await createRecipe({ author: TARGET });

    const res = await api().get(`/api/users/${TARGET}/profile?page=1&limit=1`);

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      uid: TARGET,
      displayName: 'Target Cook',
      bio: 'Bio here',
      recipeCount: 2,
      isOwner: false,
    });
    expect(res.body.recipes).toMatchObject({ page: 1, limit: 1, total: 2, totalPages: 2 });
    expect(res.body.recipes.items).toHaveLength(1);
  });

  it('marks isOwner for the user themselves', async () => {
    await createProfile(TARGET, { displayName: 'Target Cook' });

    const res = await api().get(`/api/users/${TARGET}/profile`).set(authHeader(TARGET));

    expect(res.body.user.isOwner).toBe(true);
  });

  it('404s for a uid with no profile and no recipes', async () => {
    const res = await api().get('/api/users/nobody-at-all/profile');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });
});

describe('GET /api/users/me', () => {
  it('requires authentication', async () => {
    const res = await api().get('/api/users/me');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthorized');
  });

  it('returns the caller’s own email and saved recipe ids', async () => {
    const recipe = await createRecipe({ author: 'someone-else' });
    await createProfile(ME, { displayName: 'Me', bio: 'my bio', savedRecipes: [recipe._id] });

    const res = await api().get('/api/users/me').set(authHeader(ME, 'me@example.com'));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      uid: ME,
      email: 'me@example.com',
      displayName: 'Me',
      bio: 'my bio',
    });
    expect(res.body.savedRecipeIds).toEqual([recipe.id]);
  });

  it('works for a user who has never saved a profile', async () => {
    const res = await api().get('/api/users/me').set(authHeader(ME, 'me@example.com'));

    expect(res.status).toBe(200);
    expect(res.body.uid).toBe(ME);
    expect(res.body.displayName).toBe('me@example.com');
    expect(res.body.savedRecipeIds).toEqual([]);
  });
});

describe('PUT /api/users/me', () => {
  it('creates the profile on first save', async () => {
    const res = await api()
      .put('/api/users/me')
      .set(authHeader(ME))
      .send({ displayName: 'Fresh Cook', bio: 'Hello' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ uid: ME, displayName: 'Fresh Cook', bio: 'Hello' });

    const stored = await Profile.findOne({ user: ME }).lean();
    expect(stored!.displayName).toBe('Fresh Cook');
  });

  it('rejects an empty display name', async () => {
    const res = await api()
      .put('/api/users/me')
      .set(authHeader(ME))
      .send({ displayName: '   ' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('bad_request');
    expect(await Profile.countDocuments()).toBe(0);
  });

  it('rejects a missing display name', async () => {
    const res = await api().put('/api/users/me').set(authHeader(ME)).send({ bio: 'x' });

    expect(res.status).toBe(400);
  });

  it('rejects a display name over 60 characters', async () => {
    const res = await api()
      .put('/api/users/me')
      .set(authHeader(ME))
      .send({ displayName: 'x'.repeat(61) });

    expect(res.status).toBe(400);
  });

  it('accepts a display name of exactly 60 characters', async () => {
    const res = await api()
      .put('/api/users/me')
      .set(authHeader(ME))
      .send({ displayName: 'x'.repeat(60) });

    expect(res.status).toBe(200);
  });

  it('SECURITY: strips HTML from the bio', async () => {
    const res = await api()
      .put('/api/users/me')
      .set(authHeader(ME))
      .send({ displayName: 'Cook', bio: '<img src=x onerror=alert(1)><b>bold</b> bio' });

    expect(res.status).toBe(200);
    expect(res.body.bio).not.toContain('<');
    expect(res.body.bio).not.toContain('onerror');
    expect(res.body.bio).toContain('bold');

    const stored = await Profile.findOne({ user: ME }).lean();
    expect(stored!.bio).toBe(res.body.bio);
  });

  it('SECURITY: strips HTML from the display name', async () => {
    const res = await api()
      .put('/api/users/me')
      .set(authHeader(ME))
      .send({ displayName: '<script>alert(1)</script>Cook' });

    expect(res.status).toBe(200);
    expect(res.body.displayName).toBe('Cook');
  });

  it('rejects a bio over 500 characters', async () => {
    const res = await api()
      .put('/api/users/me')
      .set(authHeader(ME))
      .send({ displayName: 'Cook', bio: 'x'.repeat(501) });

    expect(res.status).toBe(400);
  });

  it('accepts a profile picture from any https host, but not a plain http one', async () => {
    const allowed = await api()
      .put('/api/users/me')
      .set(authHeader(ME))
      .send({ displayName: 'Ada', profilePictureUrl: 'https://www.example.com/me.jpg' });
    expect(allowed.status).toBe(200);

    const insecure = await api()
      .put('/api/users/me')
      .set(authHeader(ME))
      .send({ displayName: 'Ada', profilePictureUrl: 'http://www.example.com/me.jpg' });
    expect(insecure.status).toBe(400);
  });

  it('rejects unknown keys, so savedRecipes cannot be written', async () => {
    const recipe = await createRecipe();

    const res = await api()
      .put('/api/users/me')
      .set(authHeader(ME))
      .send({ displayName: 'Cook', savedRecipes: [recipe.id], user: 'someone-else' });

    expect(res.status).toBe(400);
  });

  it('requires authentication', async () => {
    const res = await api().put('/api/users/me').send({ displayName: 'Cook' });

    expect(res.status).toBe(401);
  });
});

describe('PUT /api/users/me/saved-recipes/:recipeId', () => {
  it('toggles on then off without accumulating duplicates', async () => {
    const recipe = await createRecipe({ author: 'someone-else' });

    const on = await api()
      .put(`/api/users/me/saved-recipes/${recipe.id}`)
      .set(authHeader(ME));
    expect(on.status).toBe(200);
    expect(on.body.saved).toBe(true);
    expect(on.body.savedRecipeIds).toEqual([recipe.id]);

    const off = await api()
      .put(`/api/users/me/saved-recipes/${recipe.id}`)
      .set(authHeader(ME));
    expect(off.status).toBe(200);
    expect(off.body.saved).toBe(false);
    expect(off.body.savedRecipeIds).toEqual([]);

    const onAgain = await api()
      .put(`/api/users/me/saved-recipes/${recipe.id}`)
      .set(authHeader(ME));
    expect(onAgain.body.saved).toBe(true);
    expect(onAgain.body.savedRecipeIds).toEqual([recipe.id]);

    const stored = await Profile.findOne({ user: ME }).lean();
    expect(stored!.savedRecipes).toHaveLength(1);
  });

  it('404s for a recipe that does not exist', async () => {
    const id = new mongoose.Types.ObjectId().toString();

    const res = await api().put(`/api/users/me/saved-recipes/${id}`).set(authHeader(ME));

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
    expect(await Profile.countDocuments()).toBe(0);
  });

  it('400s for a malformed recipe id', async () => {
    const res = await api().put('/api/users/me/saved-recipes/nope').set(authHeader(ME));

    expect(res.status).toBe(400);
  });

  it('requires authentication', async () => {
    const recipe = await createRecipe();

    const res = await api().put(`/api/users/me/saved-recipes/${recipe.id}`);

    expect(res.status).toBe(401);
  });
});

describe('GET /api/users/me/saved-recipes', () => {
  it('returns an empty page when nothing is saved', async () => {
    const res = await api().get('/api/users/me/saved-recipes').set(authHeader(ME));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ items: [], total: 0, totalPages: 0 });
  });

  it('returns the saved recipes, newest first', async () => {
    const older = await createRecipe({ author: 'x', createdAt: new Date('2020-01-01'), title: 'Older' });
    const newer = await createRecipe({ author: 'x', createdAt: new Date('2024-01-01'), title: 'Newer' });

    await api().put(`/api/users/me/saved-recipes/${older.id}`).set(authHeader(ME));
    await api().put(`/api/users/me/saved-recipes/${newer.id}`).set(authHeader(ME));

    const res = await api().get('/api/users/me/saved-recipes').set(authHeader(ME));

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.items.map((r: { title: string }) => r.title)).toEqual(['Newer', 'Older']);
  });

  it('BUG REGRESSION: a deleted recipe does not inflate the total or page count', async () => {
    const owner = 'owner-uid';
    const [a, b, c] = await Promise.all([
      createRecipe({ author: owner, title: 'A' }),
      createRecipe({ author: owner, title: 'B' }),
      createRecipe({ author: owner, title: 'C' }),
    ]);

    for (const recipe of [a, b, c]) {
      const res = await api()
        .put(`/api/users/me/saved-recipes/${recipe.id}`)
        .set(authHeader(ME));
      expect(res.status).toBe(200);
    }

    const before = await api().get('/api/users/me/saved-recipes?limit=2').set(authHeader(ME));
    expect(before.body.total).toBe(3);
    expect(before.body.totalPages).toBe(2);

    // The owner deletes one of them.
    const del = await api().delete(`/api/recipes/${b.id}`).set(authHeader(owner));
    expect(del.status).toBe(200);

    const after = await api().get('/api/users/me/saved-recipes?limit=2').set(authHeader(ME));

    expect(after.status).toBe(200);
    expect(after.body.total).toBe(2);
    expect(after.body.totalPages).toBe(1);
    expect(after.body.items).toHaveLength(2);
    expect(after.body.items.map((r: { title: string }) => r.title).sort()).toEqual(['A', 'C']);

    // Page 2 is genuinely gone rather than rendering an empty phantom page.
    const page2 = await api()
      .get('/api/users/me/saved-recipes?page=2&limit=2')
      .set(authHeader(ME));
    expect(page2.body.items).toEqual([]);
    expect(page2.body.total).toBe(2);
  });

  it('requires authentication', async () => {
    const res = await api().get('/api/users/me/saved-recipes');

    expect(res.status).toBe(401);
  });
});

describe('renaming fans out to the denormalised author names', () => {
  it('PUT /api/users/me updates authorName on the user’s existing recipes', async () => {
    // Created through the API so `authorName` is resolved the way production does.
    const created = await api()
      .post('/api/recipes')
      .set(authHeader(ME, 'me@example.com'))
      .send({
        title: 'Mine',
        overview: 'o',
        instructions: '<p>i</p>',
        ingredients: [],
        tags: [],
      });
    expect(created.status).toBe(201);
    // No profile yet, so the fallback is the email's local part — never the
    // whole address.
    expect(created.body.authorName).toBe('me');

    const res = await api()
      .put('/api/users/me')
      .set(authHeader(ME, 'me@example.com'))
      .send({ displayName: 'Renamed Cook' });
    expect(res.status).toBe(200);

    const stored = await Recipe.findById(created.body._id).lean();
    expect(stored!.authorName).toBe('Renamed Cook');

    const list = await api().get('/api/recipes');
    expect(list.body.items[0].authorName).toBe('Renamed Cook');
  });

  it('PUT /api/users/me updates authorName on the user’s existing comments', async () => {
    const recipe = await createRecipe({ author: 'someone-else' });
    await createProfile(ME, { displayName: 'Old Name' });

    const comment = await api()
      .post(`/api/recipes/${recipe.id}/comments`)
      .set(authHeader(ME))
      .send({ text: 'hello' });
    expect(comment.body.authorName).toBe('Old Name');

    await api().put('/api/users/me').set(authHeader(ME)).send({ displayName: 'New Name' });

    const stored = await Comment.findById(comment.body._id).lean();
    expect(stored!.authorName).toBe('New Name');

    const detail = await api().get(`/api/recipes/${recipe.id}`);
    expect(detail.body.comments[0].authorName).toBe('New Name');
  });

  it('a rename does not disturb the comment documents’ other fields', async () => {
    const recipe = await createRecipe({ author: 'someone-else' });
    await createProfile(ME, { displayName: 'Old Name' });

    const comment = await api()
      .post(`/api/recipes/${recipe.id}/comments`)
      .set(authHeader(ME))
      .send({ text: 'hello' });

    await api().put('/api/users/me').set(authHeader(ME)).send({ displayName: 'New Name' });

    const stored = await Comment.findById(comment.body._id).lean();
    expect(stored).not.toBeNull();
    expect(stored!.text).toBe('hello');
    expect(stored!.authorId).toBe(ME);
  });

  it('the rename reaches replies as well as top-level comments', async () => {
    // Replies are comments in the same collection, but they are found by
    // `parent` rather than by walking a recipe, so a fan-out that scoped itself
    // to top-level entries would leave them stale and nothing else would notice.
    const recipe = await createRecipe({ author: 'someone-else' });
    await createProfile(ME, { displayName: 'Old Name' });

    const root = await api()
      .post(`/api/recipes/${recipe.id}/comments`)
      .set(authHeader(ME))
      .send({ text: 'my root' });
    const reply = await api()
      .post(`/api/recipes/${recipe.id}/comments`)
      .set(authHeader(ME))
      .send({ text: 'my reply', parent: root.body._id });
    expect(reply.status).toBe(201);
    expect(reply.body.authorName).toBe('Old Name');

    await api().put('/api/users/me').set(authHeader(ME)).send({ displayName: 'New Name' });

    const stored = await Comment.find({ authorId: ME }).lean();
    expect(stored).toHaveLength(2);
    expect(stored.every((comment) => comment.authorName === 'New Name')).toBe(true);

    // And the thread renders the new name at both levels.
    const detail = await api().get(`/api/recipes/${recipe.id}`);
    expect(detail.body.comments[0].authorName).toBe('New Name');
    expect(detail.body.comments[0].replies[0].authorName).toBe('New Name');
  });

  it('the rename touches nobody else’s comments', async () => {
    const recipe = await createRecipe({ author: 'someone-else' });
    await createProfile(ME, { displayName: 'Old Name' });
    await createProfile('bystander-uid', { displayName: 'Bystander' });

    const mine = await api()
      .post(`/api/recipes/${recipe.id}/comments`)
      .set(authHeader(ME))
      .send({ text: 'mine' });
    // A reply from someone else, hanging off my comment — the case an
    // over-broad `{ recipe }` or `{ parent }` filter would sweep up.
    const theirReply = await api()
      .post(`/api/recipes/${recipe.id}/comments`)
      .set(authHeader('bystander-uid'))
      .send({ text: 'theirs', parent: mine.body._id });
    const theirRoot = await api()
      .post(`/api/recipes/${recipe.id}/comments`)
      .set(authHeader('bystander-uid'))
      .send({ text: 'theirs too' });

    await api().put('/api/users/me').set(authHeader(ME)).send({ displayName: 'New Name' });

    expect(await Comment.findById(mine.body._id).lean().then((c) => c!.authorName)).toBe('New Name');
    for (const id of [theirReply.body._id, theirRoot.body._id]) {
      const stored = await Comment.findById(id).lean();
      expect(stored!.authorName).toBe('Bystander');
    }
  });

  it('a body without profilePictureUrl leaves the avatar on the user’s comments alone', async () => {
    // `PUT /api/users/me` merges rather than replaces, so an omitted key means
    // "unchanged" — not "blank it". The avatar is denormalised onto every
    // comment, so getting this wrong wipes it from a whole thread on any rename.
    const recipe = await createRecipe({ author: 'someone-else' });
    await createProfile(ME, {
      displayName: 'Old Name',
      profilePictureUrl: 'https://res.cloudinary.com/demo/image/upload/me.jpg',
    });

    const comment = await api()
      .post(`/api/recipes/${recipe.id}/comments`)
      .set(authHeader(ME))
      .send({ text: 'hello' });
    expect(comment.body.authorPictureUrl).toBe(
      'https://res.cloudinary.com/demo/image/upload/me.jpg',
    );

    // Rename only — the picture is never mentioned.
    const res = await api()
      .put('/api/users/me')
      .set(authHeader(ME))
      .send({ displayName: 'New Name' });
    expect(res.status).toBe(200);

    const stored = await Comment.findById(comment.body._id).lean();
    expect(stored!.authorName).toBe('New Name');
    expect(stored!.authorPictureUrl).toBe('https://res.cloudinary.com/demo/image/upload/me.jpg');
    // The profile itself kept it too, so the two still agree.
    expect(res.body.profilePictureUrl).toBe('https://res.cloudinary.com/demo/image/upload/me.jpg');
  });

  it('but a body that does supply profilePictureUrl fans it out', async () => {
    const recipe = await createRecipe({ author: 'someone-else' });
    await createProfile(ME, {
      displayName: 'Old Name',
      profilePictureUrl: 'https://res.cloudinary.com/demo/image/upload/old.jpg',
    });

    const comment = await api()
      .post(`/api/recipes/${recipe.id}/comments`)
      .set(authHeader(ME))
      .send({ text: 'hello' });

    await api()
      .put('/api/users/me')
      .set(authHeader(ME))
      .send({
        displayName: 'New Name',
        profilePictureUrl: 'https://res.cloudinary.com/demo/image/upload/new.jpg',
      });

    const stored = await Comment.findById(comment.body._id).lean();
    expect(stored!.authorPictureUrl).toBe('https://res.cloudinary.com/demo/image/upload/new.jpg');
  });

  it('leaves other users’ recipes and comments alone', async () => {
    const theirs = await createRecipe({ author: 'other-user', authorName: 'Other Cook' });

    await api().put('/api/users/me').set(authHeader(ME)).send({ displayName: 'Renamed' });

    const stored = await Recipe.findById(theirs.id).lean();
    expect(stored!.authorName).toBe('Other Cook');
  });

  it('a new recipe picks up the saved profile display name', async () => {
    await createProfile(ME, { displayName: 'Profile Name' });

    const res = await api()
      .post('/api/recipes')
      .set(authHeader(ME, 'me@example.com'))
      .send({ title: 'T', overview: 'o', instructions: '<p>i</p>', ingredients: [], tags: [] });

    expect(res.status).toBe(201);
    expect(res.body.authorName).toBe('Profile Name');
  });
});
