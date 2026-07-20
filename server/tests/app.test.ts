import { describe, expect, it } from 'vitest';
import recipesRouter from '../src/routes/recipes.js';
import usersRouter from '../src/routes/users.js';
import collectionsRouter from '../src/routes/collections.js';
import socialRouter from '../src/routes/social.js';
import shoppingListRouter from '../src/routes/shopping-list.js';
import uploadRouter from '../src/routes/upload.js';
import { api, authHeader } from './helpers.js';


describe('app', () => {
  it('GET /health reports ok while the database is connected', async () => {
    const res = await api().get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.database).toBe('connected');
    expect(typeof res.body.uptime).toBe('number');
  });

  it('GET / returns the service banner', async () => {
    const res = await api().get('/');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ name: 'Manzil Recipe Vault API', version: 1 });
  });

  it('an unknown route returns 404 in the error envelope', async () => {
    const res = await api().get('/api/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { code: 'not_found', message: expect.stringContaining('/api/does-not-exist') },
    });
  });

  it('an unknown method on a known path also 404s with the envelope', async () => {
    const res = await api().patch('/api/recipes');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });

  it('validation errors use the {error:{code,message,details}} envelope', async () => {
    const res = await api()
      .post('/api/recipes')
      .set(authHeader('user-a'))
      .send({ title: '' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('bad_request');
    expect(typeof res.body.error.message).toBe('string');
    expect(Array.isArray(res.body.error.details)).toBe(true);
  });

  it('auth errors use the envelope', async () => {
    const res = await api().post('/api/recipes').send({});

    expect(res.status).toBe(401);
    expect(res.body.error).toMatchObject({ code: 'unauthorized' });
    expect(typeof res.body.error.message).toBe('string');
  });

  it('a malformed ObjectId becomes a 400 envelope, never a 500', async () => {
    const res = await api().get('/api/recipes/not-an-id');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('bad_request');
  });
});

/**
 * Express answers a request with the *first* matching registration and never
 * looks at the rest, so a duplicate is invisible: the file reads as though the
 * newer handler is in charge while the older one silently serves every request.
 * That is exactly how a rewritten `GET /:id/comments` ended up returning the
 * embedded array it had just been moved out of (FINDINGS #8). One assertion
 * over the router's own table catches the whole class.
 */
describe('no route is registered twice for the same method', () => {
  const routers: [string, unknown][] = [
    ['recipes', recipesRouter],
    ['users', usersRouter],
    ['collections', collectionsRouter],
    ['social', socialRouter],
    ['shopping-list', shoppingListRouter],
    ['upload', uploadRouter],
  ];

  it.each(routers)('%s', (_name, router) => {
    // `router.stack` is Express's own routing table: one layer per
    // `router.<method>(path, ...)` call, in registration order.
    const layers = (router as { stack: { route?: { path: string; methods: Record<string, boolean> } }[] })
      .stack;

    const seen = new Set<string>();
    const duplicates: string[] = [];

    for (const layer of layers) {
      if (!layer.route) continue;
      for (const method of Object.keys(layer.route.methods)) {
        const key = `${method.toUpperCase()} ${layer.route.path}`;
        if (seen.has(key)) duplicates.push(key);
        seen.add(key);
      }
    }

    expect(duplicates).toEqual([]);
    // Guards the premise: if the internal shape ever changes, the loop above
    // would find nothing and pass vacuously.
    expect(seen.size).toBeGreaterThan(0);
  });
});
