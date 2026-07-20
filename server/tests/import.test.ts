import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Recipe } from '../src/models/Recipe.js';
import { api, authHeader } from './helpers.js';

/**
 * `POST /api/import`.
 *
 * The endpoint's defining property is what it does *not* do: it never writes.
 * It reads a page, maps it onto the form's fields, and hands them back for the
 * user to review — so every test here checks the recipe count as well as the
 * response.
 *
 * No request in this file leaves the machine. DNS is stubbed for the one
 * hostname the tests use, and `globalThis.fetch` is replaced for the duration
 * and restored afterwards.
 */

const { dnsStub } = vi.hoisted(() => ({ dnsStub: new Map<string, string[]>() }));

vi.mock('node:dns/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:dns/promises')>();
  return {
    ...actual,
    lookup: async (hostname: string, options?: { all?: boolean }) => {
      const entry = dnsStub.get(hostname);
      if (!entry) {
        return (actual.lookup as (h: string, o?: unknown) => Promise<unknown>)(hostname, options);
      }
      const records = entry.map((address) => ({
        address,
        family: address.includes(':') ? 6 : 4,
      }));
      return options?.all ? records : records[0];
    },
  };
});

const USER = 'user-a';
const HOST = 'cooking.example.net';

const RECIPE_JSON_LD = {
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'WebSite', name: 'Example Cooking' },
    {
      '@type': 'Recipe',
      name: 'Lemon Rice',
      description: 'Bright, quick, and good cold.',
      image: 'https://cdn.example.net/lemon-rice.jpg',
      recipeYield: '4 servings',
      prepTime: 'PT10M',
      cookTime: 'PT20M',
      recipeCuisine: 'South Indian',
      keywords: 'rice, quick',
      recipeIngredient: ['2 cups cooked rice', '1 tbsp mustard seeds', 'salt to taste'],
      recipeInstructions: [
        { '@type': 'HowToStep', text: 'Temper the mustard seeds.' },
        { '@type': 'HowToStep', text: 'Fold through the rice with lemon juice.' },
      ],
    },
  ],
};

function recipePage(jsonLd: unknown = RECIPE_JSON_LD): string {
  const body = JSON.stringify(jsonLd).replace(/</g, '\\u003c');
  return (
    '<!doctype html><html><head>' +
    '<meta property="og:site_name" content="Example Cooking" />' +
    `<script type="application/ld+json">${body}</script>` +
    '</head><body></body></html>'
  );
}

function htmlResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

const realFetch = globalThis.fetch;
let requested: string[] = [];

function stubFetch(responder: (url: URL) => Response | Promise<Response>): void {
  globalThis.fetch = vi.fn(async (input: unknown) => {
    const url = input instanceof URL ? input : new URL(String(input));
    requested.push(url.toString());
    return responder(url);
  }) as unknown as typeof fetch;
}

/** Posts a URL as an authenticated user. */
const importUrl = (url: unknown, uid: string | null = USER) => {
  const req = api().post('/api/import');
  if (uid) req.set(authHeader(uid));
  return req.send(url === undefined ? {} : { url });
};

beforeEach(() => {
  requested = [];
  dnsStub.clear();
  dnsStub.set(HOST, ['93.184.216.34']);
  // Default: anything that gets this far is a bug in the test, not a page.
  stubFetch((url) => {
    throw new Error(`Unexpected outbound request to ${url.toString()}`);
  });
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe('POST /api/import — authentication', () => {
  it('rejects an anonymous request', async () => {
    const res = await importUrl(`https://${HOST}/lemon-rice`, null);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthorized');
    // Refused before anything was fetched on an anonymous caller's behalf.
    expect(requested).toEqual([]);
  });

  it('rejects a malformed token', async () => {
    const res = await api()
      .post('/api/import')
      .set({ Authorization: 'Bearer nonsense' })
      .send({ url: `https://${HOST}/lemon-rice` });

    expect(res.status).toBe(401);
    expect(requested).toEqual([]);
  });
});

describe('POST /api/import — validation', () => {
  it('rejects a missing url', async () => {
    const res = await importUrl(undefined);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('bad_request');
    expect(requested).toEqual([]);
  });

  it('rejects an empty url with a message a person can act on', async () => {
    const res = await importUrl('');

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body.error.details)).toContain('Paste a link first');
  });

  it('rejects a whitespace-only url', async () => {
    const res = await importUrl('    ');

    expect(res.status).toBe(400);
    expect(requested).toEqual([]);
  });

  it('rejects a url beyond 2000 characters', async () => {
    const res = await importUrl(`https://${HOST}/${'a'.repeat(2_100)}`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('bad_request');
    expect(requested).toEqual([]);
  });

  it('rejects a non-string url', async () => {
    const res = await importUrl({ href: `https://${HOST}/` });

    expect(res.status).toBe(400);
    expect(requested).toEqual([]);
  });

  it('rejects unknown fields alongside the url', async () => {
    const res = await api()
      .post('/api/import')
      .set(authHeader(USER))
      .send({ url: `https://${HOST}/x`, save: true });

    expect(res.status).toBe(400);
    expect(requested).toEqual([]);
  });
});

describe('POST /api/import — fetching', () => {
  it('accepts a bare domain and normalises it to https', async () => {
    stubFetch(() => htmlResponse(recipePage()));

    const res = await importUrl(`${HOST}/lemon-rice`);

    expect(res.status).toBe(200);
    expect(requested).toEqual([`https://${HOST}/lemon-rice`]);
  });

  it('leaves an explicit http:// scheme alone', async () => {
    stubFetch(() => htmlResponse(recipePage()));

    const res = await importUrl(`http://${HOST}/lemon-rice`);

    expect(res.status).toBe(200);
    expect(requested).toEqual([`http://${HOST}/lemon-rice`]);
  });

  it('surfaces a blocked address as a 400 with its code, not a 500', async () => {
    const res = await importUrl('http://169.254.169.254/latest/meta-data/');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('blocked_address');
    expect(requested).toEqual([]);
  });

  it('surfaces a blocked redirect target as a 400, having stopped at the first hop', async () => {
    stubFetch((url) => {
      if (url.hostname === HOST) {
        return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/' } });
      }
      return htmlResponse(recipePage());
    });

    const res = await importUrl(`https://${HOST}/lemon-rice`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('blocked_address');
    expect(requested).toEqual([`https://${HOST}/lemon-rice`]);
  });

  it('refuses a non-http scheme', async () => {
    // The bare-domain normalisation only recognises `http(s)://`, so `file:` is
    // rewritten to `https://file:///etc/passwd` and dies at the resolver rather
    // than at the protocol check. Either way it is a 400 and nothing is opened;
    // the code is asserted so a change in *why* shows up here.
    const res = await importUrl('file:///etc/passwd');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('dns_failed');
    expect(requested).toEqual([]);
  });

  it('refuses a gopher: URL aimed at a local service', async () => {
    const res = await importUrl('gopher://127.0.0.1:6379/_INFO');

    expect(res.status).toBe(400);
    expect(['bad_protocol', 'blocked_address', 'dns_failed', 'invalid_url']).toContain(
      res.body.error.code,
    );
    expect(requested).toEqual([]);
  });

  it('refuses a bare host:port pointing at our own database', async () => {
    // Normalisation makes this `https://localhost:27017/`, which is exactly the
    // case the address rules exist for.
    const res = await importUrl('localhost:27017/');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('blocked_address');
    expect(requested).toEqual([]);
  });

  it('refuses a bare cloud-metadata address', async () => {
    const res = await importUrl('169.254.169.254/latest/meta-data/');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('blocked_address');
    expect(requested).toEqual([]);
  });

  it('refuses credentials in the authority that point somewhere private', async () => {
    const res = await importUrl(`https://${HOST}@127.0.0.1/`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('blocked_address');
    expect(requested).toEqual([]);
  });

  it('surfaces an upstream 404 as a 400 rather than a 404 of our own', async () => {
    stubFetch(() => new Response('gone', { status: 404 }));

    const res = await importUrl(`https://${HOST}/missing`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('fetch_failed');
  });

  it('surfaces a non-HTML response as a 400', async () => {
    stubFetch(
      () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    );

    const res = await importUrl(`https://${HOST}/api.json`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('not_html');
  });
});

describe('POST /api/import — no recipe on the page', () => {
  it('answers 422 with no_recipe_found and tells the user they can add it by hand', async () => {
    stubFetch(() => htmlResponse('<html><body><h1>A recipe, in prose</h1></body></html>'));

    const res = await importUrl(`https://${HOST}/prose`);

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('no_recipe_found');
    expect(res.body.error.message).toMatch(/by hand/i);
  });

  it('answers 422 when the JSON-LD has a title but no instructions', async () => {
    stubFetch(() =>
      htmlResponse(recipePage({ '@type': 'Recipe', name: 'Half a recipe' })),
    );

    const res = await importUrl(`https://${HOST}/half`);

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('no_recipe_found');
  });

  it('writes nothing when it cannot parse the page', async () => {
    stubFetch(() => htmlResponse('<html><body>nothing here</body></html>'));

    const before = await Recipe.countDocuments();
    await importUrl(`https://${HOST}/prose`);

    expect(await Recipe.countDocuments()).toBe(before);
  });
});

describe('POST /api/import — a successful import', () => {
  it('returns the parsed fields', async () => {
    stubFetch(() => htmlResponse(recipePage()));

    const res = await importUrl(`https://${HOST}/lemon-rice`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      title: 'Lemon Rice',
      overview: 'Bright, quick, and good cold.',
      image: 'https://cdn.example.net/lemon-rice.jpg',
      servings: 4,
      prepMinutes: 10,
      cookMinutes: 20,
      cuisine: 'South Indian',
      tags: ['rice', 'quick'],
      ingredients: [
        { amount: '2 cups', name: 'cooked rice' },
        { amount: '1 tbsp', name: 'mustard seeds' },
        { amount: '', name: 'salt to taste' },
      ],
    });
    expect(res.body.instructions).toBe(
      '<p>Temper the mustard seeds.</p><p>Fold through the rice with lemon juice.</p>',
    );
  });

  it('reports where the recipe came from', async () => {
    stubFetch(() => htmlResponse(recipePage()));

    const res = await importUrl(`https://${HOST}/lemon-rice`);

    expect(res.body.sourceUrl).toBe(`https://${HOST}/lemon-rice`);
    expect(res.body.sourceName).toBe('Example Cooking');
  });

  it('attributes the URL it ended on, not the one that was pasted', async () => {
    stubFetch((url) => {
      if (url.pathname === '/old') {
        return new Response(null, {
          status: 301,
          headers: { location: `https://${HOST}/recipes/lemon-rice` },
        });
      }
      return htmlResponse(recipePage());
    });

    const res = await importUrl(`https://${HOST}/old`);

    expect(res.status).toBe(200);
    expect(res.body.sourceUrl).toBe(`https://${HOST}/recipes/lemon-rice`);
  });

  it('creates no recipe — the endpoint only ever reads', async () => {
    stubFetch(() => htmlResponse(recipePage()));

    const before = await Recipe.countDocuments();
    const res = await importUrl(`https://${HOST}/lemon-rice`);

    expect(res.status).toBe(200);
    expect(await Recipe.countDocuments()).toBe(before);
    // Nor does it hand back anything that looks like a saved document.
    expect(res.body._id).toBeUndefined();
    expect(res.body.author).toBeUndefined();
  });

  it('does not create a recipe even after several imports', async () => {
    stubFetch(() => htmlResponse(recipePage()));

    await importUrl(`https://${HOST}/one`);
    await importUrl(`https://${HOST}/two`);
    await importUrl(`https://${HOST}/three`);

    expect(await Recipe.countDocuments()).toBe(0);
  });

  it('returns sanitised content when the page is hostile', async () => {
    stubFetch(() =>
      htmlResponse(
        recipePage({
          '@type': 'Recipe',
          name: 'Cake <script>alert(1)</script>',
          description: '<img src=x onerror="steal()"> a cake',
          recipeInstructions: [{ '@type': 'HowToStep', text: 'Bake <script>x()</script> it' }],
        }),
      ),
    );

    const res = await importUrl(`https://${HOST}/hostile`);

    expect(res.status).toBe(200);
    const serialised = JSON.stringify(res.body);
    expect(serialised).not.toMatch(/<script/i);
    expect(serialised).not.toMatch(/onerror\s*=/i);
    expect(res.body.title).toBe('Cake');
  });
});
