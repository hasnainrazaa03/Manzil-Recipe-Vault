import { describe, expect, it } from 'vitest';
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
