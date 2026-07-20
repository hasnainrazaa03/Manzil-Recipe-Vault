import { createServer, type Server } from 'node:http';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { Recipe } from '../src/models/Recipe.js';
import { Profile } from '../src/models/Profile.js';

let server: Server | undefined;

/**
 * Starts the app on an explicitly IPv4-loopback port, once per worker.
 *
 * `request(app)` would have supertest call `app.listen(0)` itself, which binds
 * the wildcard address — while supertest then dials `127.0.0.1` unconditionally.
 * The OS can hand out a port that is free on `::` but already held by an
 * unrelated process on `127.0.0.1`, and the request is then answered by that
 * process. It showed up as roughly one test per twenty runs failing with an
 * inexplicable status (a bare `400`, or `Client sent an HTTP request to an
 * HTTPS server`) on routes that cannot produce one. Binding to `127.0.0.1`
 * reserves the port on the interface supertest actually connects to.
 */
export async function startApi(): Promise<void> {
  const instance = createServer(createApp());
  await new Promise<void>((resolve) => instance.listen(0, '127.0.0.1', resolve));
  server = instance;
}

export async function stopApi(): Promise<void> {
  const instance = server;
  server = undefined;
  if (instance) await new Promise<void>((resolve) => instance.close(() => resolve()));
}

/** Supertest bound to the shared server. Use in place of `request(app)`. */
export function api() {
  if (!server) throw new Error('Test server is not running — check tests/setup.ts');
  return request(server);
}

/**
 * Mirrors the token format understood by the Firebase stub in `setup.ts`.
 * Any uid/email pair is accepted, so a test can be any number of users.
 */
export function testToken(uid: string, email = `${uid}@example.com`): string {
  return `test|${uid}|${email}`;
}

/** `Authorization` header for a given user, ready to hand to `.set()`. */
export function authHeader(uid: string, email = `${uid}@example.com`) {
  return { Authorization: `Bearer ${testToken(uid, email)}` } as const;
}

/** Anything that looks like an email address. */
export const EMAIL_PATTERN = /[\w.+-]+@[\w-]+\.[\w.-]+/;

/**
 * Walks a response body and reports every place an email address could reach a
 * client: an `authorEmail` key at any depth, or any string value that looks
 * like an address. Returns the JSON paths of the offenders so a failure names
 * the field rather than dumping the whole payload.
 */
export function findEmailLeaks(value: unknown, path = 'body'): string[] {
  if (typeof value === 'string') {
    return EMAIL_PATTERN.test(value) ? [`${path} = ${value}`] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry, i) => findEmailLeaks(entry, `${path}[${i}]`));
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, entry]) => {
      const child = `${path}.${key}`;
      // The key alone is a leak, even if the value happens to be empty.
      if (key === 'authorEmail') return [`${child} (authorEmail key present)`];
      return findEmailLeaks(entry, child);
    });
  }
  return [];
}

/** Asserts a response body carries no author email in any form. */
export function expectNoEmailLeak(body: unknown): void {
  const leaks = findEmailLeaks(body);
  if (leaks.length > 0) {
    throw new Error(`Response leaked author email(s):\n  ${leaks.join('\n  ')}`);
  }
}

interface RecipeOverrides {
  title?: string;
  image?: string;
  overview?: string;
  ingredients?: { amount?: string; name: string }[];
  instructions?: string;
  author?: string;
  authorEmail?: string;
  authorName?: string;
  tags?: string[];
  servings?: number | null;
  prepMinutes?: number | null;
  cookMinutes?: number | null;
  difficulty?: 'easy' | 'medium' | 'hard' | null;
  cuisine?: string;
  ratings?: { userId: string; score: number }[];
  averageRating?: number;
  ratingCount?: number;
  comments?: Record<string, unknown>[];
  commentCount?: number;
  createdAt?: Date;
}

let seq = 0;

/**
 * Inserts a recipe straight through the model, bypassing the HTTP layer.
 * Useful for arranging state that the API deliberately will not let a client
 * create (pre-existing ratings, another user's recipe, a specific createdAt).
 */
export async function createRecipe(overrides: RecipeOverrides = {}) {
  seq += 1;
  const ratings = overrides.ratings ?? [];
  const total = ratings.reduce((sum, r) => sum + r.score, 0);

  const doc = await Recipe.create({
    title: `Recipe ${seq}`,
    image: '',
    overview: `Overview for recipe ${seq}`,
    ingredients: [{ amount: '1 cup', name: 'flour' }],
    instructions: '<p>Mix everything together</p>',
    author: 'user-a',
    authorEmail: 'user-a@example.com',
    authorName: 'User A',
    tags: [],
    commentCount: overrides.comments?.length ?? 0,
    ...overrides,
    ratings,
    averageRating:
      overrides.averageRating ?? (ratings.length ? Math.round((total / ratings.length) * 10) / 10 : 0),
    ratingCount: overrides.ratingCount ?? ratings.length,
  });

  return doc;
}

/** Creates (or updates) a profile document directly. */
export async function createProfile(uid: string, fields: Record<string, unknown> = {}) {
  return Profile.findOneAndUpdate(
    { user: uid },
    { $set: { displayName: `User ${uid}`, ...fields } },
    { new: true, upsert: true },
  );
}

/** Body of an otherwise-valid create-recipe request. */
export function recipePayload(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Test Recipe',
    overview: 'A short overview',
    ingredients: [{ amount: '2', name: 'eggs' }],
    instructions: '<p>Do the thing</p>',
    tags: ['dinner'],
    ...overrides,
  };
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
