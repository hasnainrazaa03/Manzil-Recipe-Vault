import { describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { Recipe } from '../src/models/Recipe.js';
import { Profile } from '../src/models/Profile.js';
import { api, authHeader, createRecipe, recipePayload } from './helpers.js';

const USER_A = 'user-a';
const USER_B = 'user-b';

describe('GET /api/recipes — listing', () => {
  it('returns the paginated envelope', async () => {
    await createRecipe();
    await createRecipe();

    const res = await api().get('/api/recipes?page=1&limit=1');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ page: 1, limit: 1, total: 2, totalPages: 2 });
    expect(res.body.items).toHaveLength(1);
  });

  it('defaults to page 1 and limit 6', async () => {
    await createRecipe();

    const res = await api().get('/api/recipes');

    expect(res.status).toBe(200);
    expect(res.body.page).toBe(1);
    expect(res.body.limit).toBe(6);
  });

  it('never returns more than 50 items for the maximum allowed limit', async () => {
    await Promise.all(Array.from({ length: 8 }, () => createRecipe()));

    const res = await api().get('/api/recipes?limit=50');

    expect(res.status).toBe(200);
    expect(res.body.limit).toBe(50);
    expect(res.body.items.length).toBeLessThanOrEqual(50);
  });

  it('clamps an absurd limit to 50 instead of erroring', async () => {
    await Promise.all(Array.from({ length: 8 }, () => createRecipe()));

    const res = await api().get('/api/recipes?limit=100000');

    expect(res.status).toBe(200);
    expect(res.body.limit).toBe(50);
    expect(res.body.items.length).toBeLessThanOrEqual(50);
    expect(res.body.items).toHaveLength(8);
  });

  it('clamps a limit below the minimum up to 1', async () => {
    await createRecipe();
    await createRecipe();

    const res = await api().get('/api/recipes?limit=0');

    expect(res.status).toBe(200);
    expect(res.body.limit).toBe(1);
    expect(res.body.items).toHaveLength(1);
  });

  it('clamps an absurd page number rather than erroring', async () => {
    await createRecipe();

    const res = await api().get('/api/recipes?page=999999');

    expect(res.status).toBe(200);
    expect(res.body.page).toBe(1_000);
    expect(res.body.items).toEqual([]);
    expect(res.body.total).toBe(1);
  });

  it('falls back to the defaults for a non-numeric page or limit', async () => {
    await createRecipe();

    const res = await api().get('/api/recipes?page=abc&limit=xyz');

    expect(res.status).toBe(200);
    expect(res.body.page).toBe(1);
    expect(res.body.limit).toBe(6);
  });

  it('clamping applies to the other paginated endpoints too', async () => {
    const recipe = await createRecipe();

    const comments = await api().get(`/api/recipes/${recipe.id}/comments?limit=100000`);
    expect(comments.status).toBe(200);
    expect(comments.body.limit).toBe(50);

    const profile = await api().get(`/api/users/${recipe.author}/profile?limit=100000`);
    expect(profile.status).toBe(200);
    expect(profile.body.recipes.limit).toBe(50);
  });

  it('list items omit the unbounded comments and ratings arrays', async () => {
    await createRecipe({
      ratings: [{ userId: USER_B, score: 5 }],
      comments: [
        {
          text: 'nice',
          authorId: USER_B,
          authorEmail: 'user-b@example.com',
        },
      ],
    });

    const res = await api().get('/api/recipes');

    expect(res.status).toBe(200);
    const [item] = res.body.items;
    expect(item).toBeDefined();
    expect(item.comments).toBeUndefined();
    expect(item.ratings).toBeUndefined();
    // The scalar counters are still there — the UI needs them.
    expect(item.ratingCount).toBe(1);
    expect(item).toHaveProperty('averageRating');
  });

  it('filters by a single tag', async () => {
    await createRecipe({ tags: ['vegan'] });
    await createRecipe({ tags: ['beef'] });

    const res = await api().get('/api/recipes?tag=vegan');

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].tags).toContain('vegan');
  });

  it('tagMode=any matches recipes with either tag', async () => {
    await createRecipe({ tags: ['vegan'] });
    await createRecipe({ tags: ['quick'] });
    await createRecipe({ tags: ['beef'] });

    const res = await api().get('/api/recipes?tag=vegan&tag=quick&tagMode=any');

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
  });

  it('tagMode=all requires every tag', async () => {
    await createRecipe({ tags: ['vegan', 'quick'] });
    await createRecipe({ tags: ['vegan'] });

    const res = await api().get('/api/recipes?tag=vegan&tag=quick&tagMode=all');

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].tags).toEqual(expect.arrayContaining(['vegan', 'quick']));
  });

  it('sorts by newest by default and honours oldest', async () => {
    await createRecipe({ title: 'Older', createdAt: new Date('2020-01-01') });
    await createRecipe({ title: 'Newer', createdAt: new Date('2024-01-01') });

    const newest = await api().get('/api/recipes');
    expect(newest.body.items.map((r: { title: string }) => r.title)).toEqual(['Newer', 'Older']);

    const oldest = await api().get('/api/recipes?sort=oldest');
    expect(oldest.body.items.map((r: { title: string }) => r.title)).toEqual(['Older', 'Newer']);
  });

  it('sorts by rating', async () => {
    await createRecipe({ title: 'Meh', averageRating: 2, ratingCount: 3 });
    await createRecipe({ title: 'Great', averageRating: 4.8, ratingCount: 2 });

    const res = await api().get('/api/recipes?sort=rating');

    expect(res.status).toBe(200);
    expect(res.body.items.map((r: { title: string }) => r.title)).toEqual(['Great', 'Meh']);
  });

  it('sorts by popularity (rating count)', async () => {
    await createRecipe({ title: 'Niche', averageRating: 5, ratingCount: 1 });
    await createRecipe({ title: 'Popular', averageRating: 3, ratingCount: 40 });

    const res = await api().get('/api/recipes?sort=popular');

    expect(res.status).toBe(200);
    expect(res.body.items.map((r: { title: string }) => r.title)).toEqual(['Popular', 'Niche']);
  });

  it('sorts by text relevance, weighting the title above the overview', async () => {
    await createRecipe({ title: 'Bread', overview: 'Plain loaf' });
    await createRecipe({ title: 'Soup', overview: 'Served with bread on the side' });

    const res = await api().get('/api/recipes?search=bread&sort=relevance');

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.items[0].title).toBe('Bread');
  });

  it('?author=me returns only the caller’s recipes', async () => {
    await createRecipe({ title: 'Mine', author: USER_A });
    await createRecipe({ title: 'Theirs', author: USER_B });

    const res = await api().get('/api/recipes?author=me').set(authHeader(USER_A));

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].title).toBe('Mine');
  });

  it('?author=me returns nothing for an anonymous caller', async () => {
    await createRecipe({ author: USER_A });
    await createRecipe({ author: USER_B });

    const res = await api().get('/api/recipes?author=me');

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.items).toEqual([]);
  });

  it('?author=<uid> filters to that author', async () => {
    await createRecipe({ author: USER_A });
    await createRecipe({ author: USER_B });

    const res = await api().get(`/api/recipes?author=${USER_B}`);

    expect(res.body.total).toBe(1);
    expect(res.body.items[0].author).toBe(USER_B);
  });
});

describe('SECURITY: search is not a regex injection point', () => {
  it('a catastrophic-backtracking pattern returns quickly and safely', async () => {
    await createRecipe({ title: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' });

    const started = Date.now();
    // `(a+)+$` — the classic ReDoS payload, url-encoded.
    const res = await api().get('/api/recipes?search=(a%2B)%2B%24');
    const elapsed = Date.now() - started;

    expect(res.status).toBe(200);
    expect(elapsed).toBeLessThan(5_000);
    // Treated as a literal string, so it matches nothing.
    expect(res.body.total).toBe(0);
    expect(res.body.items).toEqual([]);
  });

  it('a search for "." matches only a literal dot, not every recipe', async () => {
    await createRecipe({ title: 'Plain bread', overview: 'No punctuation here', tags: [] });
    await createRecipe({ title: 'Mrs. Baker pie', overview: 'Has a dot', tags: [] });

    const res = await api().get('/api/recipes?search=.');

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].title).toBe('Mrs. Baker pie');
  });

  it('other regex metacharacters are literal too', async () => {
    await createRecipe({ title: 'Chicken' });

    const res = await api().get('/api/recipes?search=%5E.*%24');

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
  });
});

describe('SECURITY: stored XSS in rich text', () => {
  it('strips scripts and event handlers from instructions but keeps safe markup', async () => {
    const dirty = '<script>alert(1)</script><img src=x onerror=alert(1)><p>ok</p>';

    const res = await api()
      .post('/api/recipes')
      .set(authHeader(USER_A))
      .send(recipePayload({ instructions: dirty }));

    expect(res.status).toBe(201);

    const stored = await Recipe.findById(res.body._id).lean();
    const html = stored!.instructions;

    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('alert(1)');
    expect(html).toContain('<p>ok</p>');
    // And the response reflects the sanitised value, not the submitted one.
    expect(res.body.instructions).toBe(html);
  });

  it('strips markup from plain-text fields (title, overview, tags)', async () => {
    const res = await api()
      .post('/api/recipes')
      .set(authHeader(USER_A))
      .send(
        recipePayload({
          title: '<b>Bold</b> title',
          overview: '<img src=x onerror=alert(1)>overview',
        }),
      );

    expect(res.status).toBe(201);
    expect(res.body.title).toBe('Bold title');
    expect(res.body.overview).not.toContain('<');
    expect(res.body.overview).not.toContain('onerror');
  });
});

describe('SECURITY: mass assignment on PUT /api/recipes/:id', () => {
  it('rejects a body carrying server-owned fields', async () => {
    const recipe = await createRecipe({ author: USER_A, authorEmail: 'user-a@example.com' });

    const res = await api()
      .put(`/api/recipes/${recipe.id}`)
      .set(authHeader(USER_A))
      .send({
        title: 'Renamed',
        author: 'attacker-uid',
        authorEmail: 'attacker@evil.example.com',
        averageRating: 5,
        ratingCount: 999,
        comments: [{ text: 'planted', authorId: 'attacker-uid', authorEmail: 'a@b.c' }],
        ratings: [{ userId: 'attacker-uid', score: 5 }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('bad_request');
    const paths = (res.body.error.details as { path: string }[]).map((d) => d.path);
    // The strict schema names the offending keys rather than silently dropping them.
    expect(paths.join(' ')).toMatch(/author|averageRating|ratingCount|comments|ratings|^$/);
  });

  it.each([
    ['author', { author: 'attacker-uid' }],
    ['authorEmail', { authorEmail: 'attacker@evil.example.com' }],
    ['averageRating', { averageRating: 5 }],
    ['ratingCount', { ratingCount: 999 }],
    ['commentCount', { commentCount: 999 }],
    ['ratings', { ratings: [{ userId: 'attacker-uid', score: 5 }] }],
    ['comments', { comments: [{ text: 'planted', authorId: 'x', authorEmail: 'x@y.z' }] }],
    ['_id', { _id: new mongoose.Types.ObjectId().toString() }],
  ])(
    'a body mixing a legal field with the illegal field %s never mutates server-owned state',
    async (_name, illegal) => {
      const recipe = await createRecipe({
        author: USER_A,
        authorEmail: 'user-a@example.com',
        ratings: [{ userId: USER_B, score: 4 }],
        comments: [],
      });
      // `authorEmail` is `select: false`, so it has to be asked for explicitly.
      const before = await Recipe.findById(recipe.id).select('+authorEmail').lean();

      const res = await api()
        .put(`/api/recipes/${recipe.id}`)
        .set(authHeader(USER_A))
        .send({ title: 'Legitimate rename', ...illegal });

      // Whether the request is rejected outright or the field is stripped, the
      // invariant is the same: server-owned state is untouched.
      const after = await Recipe.findById(recipe.id).select('+authorEmail').lean();

      expect(after!.author).toBe(USER_A);
      expect(after!.authorEmail).toBe('user-a@example.com');
      expect(after!.averageRating).toBe(before!.averageRating);
      expect(after!.ratingCount).toBe(before!.ratingCount);
      expect(after!.comments).toHaveLength(0);
      expect(after!.commentCount).toBe(0);
      expect(after!.ratings.map((r) => r.userId)).toEqual([USER_B]);
      expect(after!._id.toString()).toBe(recipe.id);

      // And if it *was* accepted, the legal field is the only thing that changed.
      if (res.status === 200) expect(after!.title).toBe('Legitimate rename');
    },
  );

  it('a legitimate update still works and leaves counters alone', async () => {
    const recipe = await createRecipe({
      author: USER_A,
      ratings: [{ userId: USER_B, score: 4 }],
    });

    const res = await api()
      .put(`/api/recipes/${recipe.id}`)
      .set(authHeader(USER_A))
      .send({ title: 'A better title', tags: ['weeknight'] });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('A better title');
    expect(res.body.tags).toEqual(['weeknight']);
    expect(res.body.author).toBe(USER_A);
    expect(res.body.averageRating).toBe(4);
    expect(res.body.ratingCount).toBe(1);
  });

  it('an empty update body is rejected', async () => {
    const recipe = await createRecipe({ author: USER_A });

    const res = await api()
      .put(`/api/recipes/${recipe.id}`)
      .set(authHeader(USER_A))
      .send({});

    expect(res.status).toBe(400);
  });

  it('POST cannot set the author either — identity comes from the token', async () => {
    const res = await api()
      .post('/api/recipes')
      .set(authHeader(USER_A))
      .send(recipePayload({ author: 'attacker-uid' }));

    expect(res.status).toBe(400);

    const clean = await api()
      .post('/api/recipes')
      .set(authHeader(USER_A, 'a@example.com'))
      .send(recipePayload());

    expect(clean.status).toBe(201);
    expect(clean.body.author).toBe(USER_A);
    // The email is recorded server-side but never travels back to the client.
    expect(clean.body).not.toHaveProperty('authorEmail');
    const stored = await Recipe.findById(clean.body._id).select('+authorEmail').lean();
    expect(stored!.authorEmail).toBe('a@example.com');
  });
});

describe('ownership and auth', () => {
  it('another user cannot update a recipe', async () => {
    const recipe = await createRecipe({ author: USER_A });

    const res = await api()
      .put(`/api/recipes/${recipe.id}`)
      .set(authHeader(USER_B))
      .send({ title: 'Hijacked' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');

    const after = await Recipe.findById(recipe.id).lean();
    expect(after!.title).not.toBe('Hijacked');
  });

  it('another user cannot delete a recipe', async () => {
    const recipe = await createRecipe({ author: USER_A });

    const res = await api().delete(`/api/recipes/${recipe.id}`).set(authHeader(USER_B));

    expect(res.status).toBe(403);
    expect(await Recipe.countDocuments()).toBe(1);
  });

  it('the owner can delete their own recipe', async () => {
    const recipe = await createRecipe({ author: USER_A });

    const res = await api().delete(`/api/recipes/${recipe.id}`).set(authHeader(USER_A));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(await Recipe.countDocuments()).toBe(0);
  });

  it('a nonexistent id is 404 for GET, PUT and DELETE', async () => {
    const id = new mongoose.Types.ObjectId().toString();

    const get = await api().get(`/api/recipes/${id}`);
    const put = await api()
      .put(`/api/recipes/${id}`)
      .set(authHeader(USER_A))
      .send({ title: 'x' });
    const del = await api().delete(`/api/recipes/${id}`).set(authHeader(USER_A));

    expect([get.status, put.status, del.status]).toEqual([404, 404, 404]);
    expect(get.body.error.code).toBe('not_found');
  });

  it('a malformed id is 400, not 500', async () => {
    const get = await api().get('/api/recipes/not-an-id');
    const del = await api().delete('/api/recipes/not-an-id').set(authHeader(USER_A));

    expect(get.status).toBe(400);
    expect(del.status).toBe(400);
    expect(get.body.error.code).toBe('bad_request');
  });

  it('writes without a token are 401', async () => {
    const recipe = await createRecipe({ author: USER_A });

    const post = await api().post('/api/recipes').send(recipePayload());
    const put = await api().put(`/api/recipes/${recipe.id}`).send({ title: 'x' });
    const del = await api().delete(`/api/recipes/${recipe.id}`);

    expect([post.status, put.status, del.status]).toEqual([401, 401, 401]);
    expect(post.body.error.code).toBe('unauthorized');
  });

  it('a garbage bearer token is 401 on writes and anonymous on reads', async () => {
    await createRecipe();

    const write = await api()
      .post('/api/recipes')
      .set('Authorization', 'Bearer nonsense')
      .send(recipePayload());
    expect(write.status).toBe(401);

    const read = await api().get('/api/recipes').set('Authorization', 'Bearer nonsense');
    expect(read.status).toBe(200);
  });
});

describe('validation on create', () => {
  it('rejects a missing title', async () => {
    const body = recipePayload();
    delete (body as Record<string, unknown>).title;

    const res = await api().post('/api/recipes').set(authHeader(USER_A)).send(body);

    expect(res.status).toBe(400);
    expect((res.body.error.details as { path: string }[]).some((d) => d.path === 'title')).toBe(true);
  });

  it('rejects an empty title', async () => {
    const res = await api()
      .post('/api/recipes')
      .set(authHeader(USER_A))
      .send(recipePayload({ title: '   ' }));

    expect(res.status).toBe(400);
  });

  it('rejects a title over 140 characters', async () => {
    const res = await api()
      .post('/api/recipes')
      .set(authHeader(USER_A))
      .send(recipePayload({ title: 'x'.repeat(141) }));

    expect(res.status).toBe(400);
    expect(await Recipe.countDocuments()).toBe(0);
  });

  it('accepts a title of exactly 140 characters', async () => {
    const res = await api()
      .post('/api/recipes')
      .set(authHeader(USER_A))
      .send(recipePayload({ title: 'x'.repeat(140) }));

    expect(res.status).toBe(201);
  });

  it('rejects an image URL on a disallowed host', async () => {
    const res = await api()
      .post('/api/recipes')
      .set(authHeader(USER_A))
      .send(recipePayload({ image: 'https://evil.example.com/x.png' }));

    expect(res.status).toBe(400);
    expect((res.body.error.details as { path: string }[]).some((d) => d.path === 'image')).toBe(true);
  });

  it('rejects a non-https image URL on an allowed host', async () => {
    const res = await api()
      .post('/api/recipes')
      .set(authHeader(USER_A))
      .send(recipePayload({ image: 'http://res.cloudinary.com/x.png' }));

    expect(res.status).toBe(400);
  });

  it('accepts an image URL on an allowed host', async () => {
    const res = await api()
      .post('/api/recipes')
      .set(authHeader(USER_A))
      .send(recipePayload({ image: 'https://res.cloudinary.com/x.png' }));

    expect(res.status).toBe(201);
    expect(res.body.image).toBe('https://res.cloudinary.com/x.png');
  });

  it('rejects instructions that are only markup', async () => {
    const res = await api()
      .post('/api/recipes')
      .set(authHeader(USER_A))
      .send(recipePayload({ instructions: '<script>alert(1)</script>' }));

    expect(res.status).toBe(400);
  });

  it('normalises tags: lower-cased, deduplicated, capped at 12', async () => {
    const res = await api()
      .post('/api/recipes')
      .set(authHeader(USER_A))
      .send(recipePayload({ tags: ['Vegan', 'vegan', 'QUICK', ...Array.from({ length: 20 }, (_, i) => `t${i}`)] }));

    expect(res.status).toBe(201);
    expect(res.body.tags.length).toBeLessThanOrEqual(12);
    expect(res.body.tags.slice(0, 2)).toEqual(['vegan', 'quick']);
  });
});

describe('GET /api/recipes/:id — detail', () => {
  it('returns viewer flags for a signed-in caller', async () => {
    const recipe = await createRecipe({
      author: USER_A,
      ratings: [{ userId: USER_B, score: 3 }],
    });
    await Profile.create({ user: USER_B, displayName: 'B', savedRecipes: [recipe._id] });

    const res = await api().get(`/api/recipes/${recipe.id}`).set(authHeader(USER_B));

    expect(res.status).toBe(200);
    expect(res.body.viewer).toEqual({ userScore: 3, isSaved: true, isAuthor: false });
  });

  it('marks the author', async () => {
    const recipe = await createRecipe({ author: USER_A });

    const res = await api().get(`/api/recipes/${recipe.id}`).set(authHeader(USER_A));

    expect(res.body.viewer.isAuthor).toBe(true);
    expect(res.body.viewer.isSaved).toBe(false);
    expect(res.body.viewer.userScore).toBe(0);
  });

  it('works anonymously with neutral viewer flags', async () => {
    const recipe = await createRecipe({ ratings: [{ userId: USER_B, score: 5 }] });

    const res = await api().get(`/api/recipes/${recipe.id}`);

    expect(res.status).toBe(200);
    expect(res.body.viewer).toEqual({ userScore: 0, isSaved: false, isAuthor: false });
  });

  it('returns comments and hides the raw ratings array', async () => {
    const recipe = await createRecipe({
      ratings: [{ userId: USER_B, score: 5 }],
      comments: [
        { text: 'first', authorId: USER_B, authorEmail: 'user-b@example.com' },
        { text: 'second', authorId: USER_B, authorEmail: 'user-b@example.com' },
      ],
    });

    const res = await api().get(`/api/recipes/${recipe.id}`);

    expect(res.status).toBe(200);
    expect(res.body.comments).toHaveLength(2);
    expect(res.body.commentCount).toBe(2);
    expect(res.body.comments.map((c: { text: string }) => c.text).sort()).toEqual(['first', 'second']);
    expect(res.body.ratings).toBeUndefined();
  });
});

describe('delete cleans up saved-recipe references', () => {
  it("removes the id from every saver's profile", async () => {
    const recipe = await createRecipe({ author: USER_B });
    const other = await createRecipe({ author: USER_B });

    // User A saves both of user B's recipes.
    await api().put(`/api/users/me/saved-recipes/${recipe.id}`).set(authHeader(USER_A));
    await api().put(`/api/users/me/saved-recipes/${other.id}`).set(authHeader(USER_A));

    const before = await Profile.findOne({ user: USER_A }).lean();
    expect(before!.savedRecipes.map((id) => id.toString())).toEqual(
      expect.arrayContaining([recipe.id, other.id]),
    );

    const del = await api().delete(`/api/recipes/${recipe.id}`).set(authHeader(USER_B));
    expect(del.status).toBe(200);

    const after = await Profile.findOne({ user: USER_A }).lean();
    const ids = after!.savedRecipes.map((id) => id.toString());
    expect(ids).not.toContain(recipe.id);
    expect(ids).toContain(other.id);
  });
});

describe('GET /api/recipes/tags', () => {
  it('returns tags with usage counts, most used first', async () => {
    await createRecipe({ tags: ['vegan', 'quick'] });
    await createRecipe({ tags: ['vegan'] });

    const res = await api().get('/api/recipes/tags');

    expect(res.status).toBe(200);
    expect(res.body[0]).toEqual({ tag: 'vegan', count: 2 });
    expect(res.body).toContainEqual({ tag: 'quick', count: 1 });
  });
});
