import { describe, expect, it } from 'vitest';
import { api, ApiError, uploadImage } from '../api';
import { API, HttpResponse, errorResponse, http, server } from '../../test/mswServer';
import { makeRecipeSummary, paginated } from '../../test/factories';
import { signIn } from '../../test/auth';

describe('api client', () => {
  it('returns the parsed payload on success', async () => {
    server.use(
      http.get(`${API}/api/recipes`, () =>
        HttpResponse.json(paginated([makeRecipeSummary({ title: 'Pilau' })])),
      ),
    );

    const result = await api.recipes.list();
    expect(result.items[0]?.title).toBe('Pilau');
    expect(result.totalPages).toBe(1);
  });

  it('turns the error envelope into a typed ApiError', async () => {
    server.use(
      http.get(`${API}/api/recipes/:id`, () =>
        errorResponse(404, 'not_found', 'Recipe not found'),
      ),
    );

    // This is the crash path that used to blank the page: the body was an
    // error envelope, `data.recipes` was undefined, and the next `.length` threw.
    await expect(api.recipes.get('507f1f77bcf86cd799439011')).rejects.toMatchObject({
      name: 'ApiError',
      status: 404,
      code: 'not_found',
      message: 'Recipe not found',
    });
  });

  it('exposes per-field messages from a validation failure', async () => {
    signIn();
    server.use(
      http.post(`${API}/api/recipes`, () =>
        HttpResponse.json(
          {
            error: {
              code: 'bad_request',
              message: 'Request validation failed',
              details: [
                { path: 'title', message: 'Title is required' },
                { path: 'overview', message: 'Too long' },
              ],
            },
          },
          { status: 400 },
        ),
      ),
    );

    try {
      await api.recipes.create({
        title: '',
        overview: '',
        image: '',
        ingredients: [],
        instructions: '',
        tags: [],
      });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).fieldMessages).toEqual([
        'title: Title is required',
        'overview: Too long',
      ]);
    }
  });

  it('reports an unreachable server as a network error rather than throwing raw', async () => {
    server.use(http.get(`${API}/api/recipes`, () => HttpResponse.error()));

    await expect(api.recipes.list()).rejects.toMatchObject({
      code: 'network_error',
      status: 0,
    });
  });

  it('refuses an authenticated call when nobody is signed in', async () => {
    await expect(api.users.me()).rejects.toMatchObject({
      status: 401,
      code: 'unauthenticated',
    });
  });

  it('serialises array query params as repeated keys', async () => {
    let requestUrl = '';
    server.use(
      http.get(`${API}/api/recipes`, ({ request }) => {
        requestUrl = request.url;
        return HttpResponse.json(paginated([]));
      }),
    );

    await api.recipes.list({ tag: ['vegan', 'quick'], tagMode: 'all', page: 2 });

    const params = new URL(requestUrl).searchParams;
    expect(params.getAll('tag')).toEqual(['vegan', 'quick']);
    expect(params.get('tagMode')).toBe('all');
    expect(params.get('page')).toBe('2');
  });

  it('omits empty and undefined query params', async () => {
    let requestUrl = '';
    server.use(
      http.get(`${API}/api/recipes`, ({ request }) => {
        requestUrl = request.url;
        return HttpResponse.json(paginated([]));
      }),
    );

    await api.recipes.list({ search: '', tag: undefined, page: 1 });

    const params = new URL(requestUrl).searchParams;
    expect(params.has('search')).toBe(false);
    expect(params.has('tag')).toBe(false);
  });
});

describe('uploadImage', () => {
  it('rejects a file over the size limit before contacting the server', async () => {
    const huge = new File([new Uint8Array(11 * 1024 * 1024)], 'big.png', { type: 'image/png' });

    await expect(uploadImage(huge, 'recipe')).rejects.toMatchObject({
      code: 'file_too_large',
    });
  });

  it('rejects a non-image file', async () => {
    const script = new File(['#!/bin/sh'], 'payload.sh', { type: 'application/x-sh' });

    await expect(uploadImage(script, 'recipe')).rejects.toMatchObject({
      code: 'invalid_file_type',
    });
  });
});
