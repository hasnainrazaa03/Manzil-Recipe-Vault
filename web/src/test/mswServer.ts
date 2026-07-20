import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { makeRecipeDetail, makeRecipeSummary, paginated } from './factories';

const API = 'http://localhost:4000';

/** Matches the server's `{error:{code,message}}` envelope. */
export function errorResponse(status: number, code: string, message: string) {
  return HttpResponse.json({ error: { code, message } }, { status });
}

export const defaultHandlers = [
  http.get(`${API}/api/recipes`, () => HttpResponse.json(paginated([makeRecipeSummary()]))),

  http.get(`${API}/api/recipes/tags`, () =>
    HttpResponse.json([
      { tag: 'dessert', count: 4 },
      { tag: 'baking', count: 2 },
    ]),
  ),

  http.get(`${API}/api/recipes/:id`, () => HttpResponse.json(makeRecipeDetail())),

  http.get(`${API}/api/users/me`, () =>
    HttpResponse.json({
      uid: 'user-1',
      email: 'amina@example.com',
      displayName: 'Amina',
      bio: '',
      profilePictureUrl: '',
      savedRecipeIds: [],
    }),
  ),
];

export const server = setupServer(...defaultHandlers);

export { http, HttpResponse, API };
