import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../src/lib/errors.js';

/**
 * The SSRF guard in `src/lib/safeFetch.ts`.
 *
 * `fetchPublicPage` is the one place in the app where a user's input decides
 * which host our server talks to, so it is tested directly rather than through
 * the route: the assertions are about *which* refusal happened, and an HTTP
 * status would flatten several different refusals into one 400.
 *
 * Two rules for everything below, both learned the hard way:
 *
 *  1. Never assert only "it threw". A request that fails because DNS is
 *     unavailable, or because the stub returned something unexpected, would
 *     make a security test pass while proving nothing. Every refusal here is
 *     matched against its documented `code`.
 *  2. Nothing leaves this machine. `globalThis.fetch` is stubbed for every test
 *     and restored afterwards; a stub that is called at all when the guard
 *     should have refused is itself a failure.
 */

/**
 * DNS is stubbed *selectively*. Hostnames registered in `dnsStub` answer from
 * the table; everything else falls through to the real resolver.
 *
 * The fall-through matters. `localhost` and the decimal form `2130706433` are
 * resolved by the C library without touching the network, and those are exactly
 * the cases where a hand-written stub would end up testing itself rather than
 * the guard. Only genuinely public hostnames — which we must not really look
 * up — are faked.
 */
const { dnsStub } = vi.hoisted(() => ({
  dnsStub: new Map<string, string[] | 'unresolvable'>(),
}));

vi.mock('node:dns/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:dns/promises')>();
  return {
    ...actual,
    lookup: async (hostname: string, options?: { all?: boolean }) => {
      const entry = dnsStub.get(hostname);
      if (entry === undefined) {
        return (actual.lookup as (h: string, o?: unknown) => Promise<unknown>)(hostname, options);
      }
      if (entry === 'unresolvable') {
        throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' });
      }
      const records = entry.map((address) => ({
        address,
        family: address.includes(':') ? 6 : 4,
      }));
      return options?.all ? records : records[0];
    },
  };
});

const { fetchPublicPage } = await import('../src/lib/safeFetch.js');

/** A hostname the guard must treat as ordinary public internet. */
const PUBLIC = 'recipes.example.net';
const PUBLIC_URL = `https://${PUBLIC}/dinner`;

const realFetch = globalThis.fetch;

/** URLs the stub was asked for, in order. The SSRF assertions live on this. */
let requested: string[] = [];

type Responder = (url: URL, init?: RequestInit) => Response | Promise<Response>;

/**
 * Replaces `globalThis.fetch` and records every URL it is handed.
 *
 * The default responder throws: unless a test says otherwise, *any* outbound
 * request is a bug, and it should fail loudly rather than quietly return
 * something plausible.
 */
function stubFetch(responder?: Responder): void {
  globalThis.fetch = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = input instanceof URL ? input : new URL(String(input));
    requested.push(url.toString());
    if (!responder) throw new Error(`Unexpected outbound request to ${url.toString()}`);
    return responder(url, init);
  }) as unknown as typeof fetch;
}

function html(body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', ...headers },
  });
}

function redirect(location: string | null, status = 302): Response {
  return new Response(null, {
    status,
    headers: location === null ? {} : { location },
  });
}

/**
 * Asserts the call was refused and hands back the AppError so the caller can
 * check its `code`. Throwing when the call *succeeds* is the point: a silent
 * `undefined` would let a bypass read as a pass.
 */
async function refusal(url: string): Promise<AppError> {
  let error: unknown;
  try {
    await fetchPublicPage(url);
  } catch (caught) {
    error = caught;
  }
  if (error === undefined) {
    throw new Error(`Expected ${url} to be refused, but the fetch succeeded`);
  }
  if (!(error instanceof AppError)) {
    throw new Error(`Expected an AppError for ${url}, got: ${String(error)}`);
  }
  return error;
}

/** Refused, for the stated reason, without a single packet being sent. */
async function expectBlockedBeforeAnyRequest(url: string, code = 'blocked_address'): Promise<void> {
  const error = await refusal(url);
  expect.soft(error.code, `${url} was refused, but with code '${error.code}'`).toBe(code);
  expect
    .soft(requested, `${url} reached the network before being refused`)
    .toEqual([]);
}

beforeEach(() => {
  requested = [];
  dnsStub.clear();
  dnsStub.set(PUBLIC, ['93.184.216.34']);
  stubFetch();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe('fetchPublicPage — positive control', () => {
  /**
   * Without this, every other test in the file could be passing for the wrong
   * reason: a guard that refuses *everything* satisfies all of them.
   */
  it('fetches a public HTTPS page and reports the URL it actually read', async () => {
    stubFetch(() => html('<html><body>hello</body></html>'));

    const page = await fetchPublicPage(PUBLIC_URL);

    expect(page.html).toContain('hello');
    expect(page.finalUrl).toBe(PUBLIC_URL);
    expect(requested).toEqual([PUBLIC_URL]);
  });

  it('sends a plain http request to a public host too', async () => {
    dnsStub.set('blog.example.org', ['198.51.100.7']);
    stubFetch(() => html('<p>ok</p>'));

    const page = await fetchPublicPage('http://blog.example.org/recipe');

    expect(page.html).toBe('<p>ok</p>');
    expect(requested).toEqual(['http://blog.example.org/recipe']);
  });
});

describe('fetchPublicPage — cloud instance metadata', () => {
  it('refuses the metadata service by address', async () => {
    await expectBlockedBeforeAnyRequest('http://169.254.169.254/');
  });

  it('refuses the metadata service written as an IPv4-mapped IPv6 literal', async () => {
    // `new URL()` normalises this to `[::ffff:a9fe:a9fe]`, which matches no
    // textual rule for link-local but routes straight to it.
    await expectBlockedBeforeAnyRequest('http://[::ffff:169.254.169.254]/');
  });

  it('refuses the metadata path with a port and query attached', async () => {
    await expectBlockedBeforeAnyRequest(
      'http://169.254.169.254:80/latest/meta-data/iam/security-credentials/?x=1',
    );
  });
});

describe('fetchPublicPage — loopback in every spelling', () => {
  const spellings = [
    'http://127.0.0.1/',
    'http://127.0.0.1:27017/',
    'http://127.1.2.3/', // the whole /8, not just .0.1
    'http://localhost/',
    'http://localhost:27017/admin',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[0:0:0:0:0:ffff:7f00:1]/',
    'http://[::127.0.0.1]/',
    'http://2130706433/', // 127.0.0.1 as a single decimal, which getaddrinfo accepts
  ];

  for (const url of spellings) {
    it(`refuses ${url}`, async () => {
      await expectBlockedBeforeAnyRequest(url);
    });
  }
});

describe('fetchPublicPage — private and reserved IPv4', () => {
  const addresses = [
    '10.0.0.1',
    '172.16.0.1',
    '172.31.255.254', // top of the /12; 172.32.x is public and must not be here
    '192.168.1.1',
    '100.64.0.1', // carrier-grade NAT
    '0.0.0.0',
    '169.254.1.1',
    '224.0.0.1', // multicast
    '255.255.255.255', // broadcast
  ];

  for (const address of addresses) {
    it(`refuses ${address}`, async () => {
      await expectBlockedBeforeAnyRequest(`http://${address}/`);
    });
  }

  it('still allows an address just outside a blocked range', async () => {
    // Guards against an over-broad mask quietly blocking the public internet,
    // which would make every "refused" assertion above meaningless.
    dnsStub.set('edge.example.net', ['172.32.0.1']);
    stubFetch(() => html('<p>public</p>'));

    await expect(fetchPublicPage('http://edge.example.net/')).resolves.toMatchObject({
      html: '<p>public</p>',
    });
  });
});

describe('fetchPublicPage — private, link-local and multicast IPv6', () => {
  const literals = [
    '[fd00::1]', // unique local
    '[fc00::abcd]',
    '[fe80::1]', // link-local
    '[ff02::1]', // multicast, all nodes
    '[64:ff9b::7f00:1]', // NAT64 wrapper around 127.0.0.1
    '[2001:db8::1]', // documentation
    '[::]', // unspecified
  ];

  for (const literal of literals) {
    it(`refuses ${literal}`, async () => {
      await expectBlockedBeforeAnyRequest(`http://${literal}/`);
    });
  }

  it('refuses a link-local literal carrying a zone id', async () => {
    // `new URL()` will not accept a zone id at all, so this never reaches the
    // address rules — refused earlier, but refused, and the code says which.
    await expectBlockedBeforeAnyRequest('http://[fe80::1%25eth0]/', 'invalid_url');
  });

  it('allows a genuinely public IPv6 literal', async () => {
    stubFetch(() => html('<p>v6</p>'));

    await expect(fetchPublicPage('http://[2606:4700::1111]/')).resolves.toMatchObject({
      html: '<p>v6</p>',
    });
  });
});

describe('fetchPublicPage — non-HTTP schemes', () => {
  const schemes = [
    'file:///etc/passwd',
    'gopher://127.0.0.1:6379/_INFO',
    'ftp://ftp.example.com/recipe.txt',
    'data:text/html,<h1>hi</h1>',
    'javascript:alert(1)',
    'chrome://settings',
  ];

  for (const url of schemes) {
    it(`refuses ${url}`, async () => {
      await expectBlockedBeforeAnyRequest(url, 'bad_protocol');
    });
  }
});

describe('fetchPublicPage — garbage input', () => {
  it('refuses an empty string', async () => {
    await expectBlockedBeforeAnyRequest('', 'invalid_url');
  });

  it('refuses a string that is not a URL', async () => {
    await expectBlockedBeforeAnyRequest('not a url', 'invalid_url');
  });

  it('refuses whitespace only', async () => {
    await expectBlockedBeforeAnyRequest('   ', 'invalid_url');
  });

  it('refuses a 3000-character URL without hanging on it', async () => {
    // `fetchPublicPage` itself has no length cap — the 2000-character ceiling
    // lives in the route's Zod schema — so what is asserted here is that an
    // absurd hostname is refused at the resolver rather than dialled.
    const hostname = `${'a'.repeat(3000)}.example`;
    dnsStub.set(hostname, 'unresolvable');

    const url = `http://${hostname}/`;
    expect(url.length).toBeGreaterThan(3000);
    await expectBlockedBeforeAnyRequest(url, 'dns_failed');
  });

  it('refuses a host that does not resolve', async () => {
    dnsStub.set('nope.invalid', 'unresolvable');
    await expectBlockedBeforeAnyRequest('http://nope.invalid/', 'dns_failed');
  });

  it('refuses a host that resolves to nothing at all', async () => {
    dnsStub.set('empty.example.net', []);
    await expectBlockedBeforeAnyRequest('http://empty.example.net/');
  });
});

describe('fetchPublicPage — DNS answers', () => {
  it('refuses a public-looking host that resolves to loopback', async () => {
    // The classic bypass: the URL is unimpeachable, the A record is not.
    dnsStub.set('sneaky.example.net', ['127.0.0.1']);
    await expectBlockedBeforeAnyRequest('http://sneaky.example.net/');
  });

  it('refuses a host that answers with one public AND one private address', async () => {
    // Checking only the first answer would let this through, and which answer
    // comes first is the attacker's choice.
    dnsStub.set('mixed.example.net', ['93.184.216.34', '10.1.2.3']);
    await expectBlockedBeforeAnyRequest('http://mixed.example.net/');
  });

  it('refuses a host whose only answer is an IPv6 unique-local address', async () => {
    dnsStub.set('v6only.example.net', ['fd12:3456::1']);
    await expectBlockedBeforeAnyRequest('http://v6only.example.net/');
  });
});

describe('fetchPublicPage — redirects', () => {
  it('refuses a 302 to loopback AND never attempts the second request', async () => {
    stubFetch((url) => {
      if (url.hostname === PUBLIC) return redirect('http://127.0.0.1/');
      return html('<p>should never be reached</p>');
    });

    const error = await refusal(PUBLIC_URL);

    expect(error.code).toBe('blocked_address');
    // The assertion that actually matters: one request, to the public host.
    expect(requested).toEqual([PUBLIC_URL]);
  });

  it('refuses a 302 to the cloud metadata service after a clean first hop', async () => {
    stubFetch((url) => {
      if (url.hostname === PUBLIC) return redirect('http://169.254.169.254/latest/meta-data/');
      return html('<p>credentials</p>');
    });

    const error = await refusal(PUBLIC_URL);

    expect(error.code).toBe('blocked_address');
    expect(requested).toEqual([PUBLIC_URL]);
  });

  it('refuses a redirect to a non-HTTP scheme', async () => {
    stubFetch((url) => {
      if (url.hostname === PUBLIC) return redirect('file:///etc/passwd');
      return html('<p>no</p>');
    });

    const error = await refusal(PUBLIC_URL);

    expect(error.code).toBe('bad_protocol');
    expect(requested).toEqual([PUBLIC_URL]);
  });

  it('follows a redirect between two public hosts and attributes the final URL', async () => {
    dnsStub.set('cdn.example.net', ['198.51.100.9']);
    stubFetch((url) => {
      if (url.hostname === PUBLIC) return redirect('https://cdn.example.net/final');
      return html('<p>arrived</p>');
    });

    const page = await fetchPublicPage(PUBLIC_URL);

    expect(page.html).toBe('<p>arrived</p>');
    expect(page.finalUrl).toBe('https://cdn.example.net/final');
    expect(requested).toEqual([PUBLIC_URL, 'https://cdn.example.net/final']);
  });

  it('fails with too_many_redirects once the chain exceeds the cap', async () => {
    dnsStub.set('hop.example.net', ['198.51.100.10']);
    let hop = 0;
    stubFetch(() => {
      hop += 1;
      return redirect(`https://hop.example.net/${hop}`);
    });

    const error = await refusal(PUBLIC_URL);

    expect(error.code).toBe('too_many_redirects');
    // MAX_REDIRECTS is 3, so the loop body runs four times and then gives up.
    expect(requested).toHaveLength(4);
    expect(requested.length).toBeLessThan(10);
  });

  it('fails cleanly on a redirect with no Location header', async () => {
    stubFetch(() => redirect(null));

    const error = await refusal(PUBLIC_URL);

    expect(error.code).toBe('bad_redirect');
    expect(requested).toEqual([PUBLIC_URL]);
  });

  it('resolves a relative Location against the current URL', async () => {
    stubFetch((url) => {
      if (url.pathname === '/dinner') return redirect('/recipes/soup');
      return html('<p>soup</p>');
    });

    const page = await fetchPublicPage(PUBLIC_URL);

    expect(page.finalUrl).toBe(`https://${PUBLIC}/recipes/soup`);
    expect(requested).toEqual([PUBLIC_URL, `https://${PUBLIC}/recipes/soup`]);
  });

  it('validates the host of a protocol-relative Location', async () => {
    // `//127.0.0.1/` inherits https: and must still be checked.
    stubFetch((url) => {
      if (url.hostname === PUBLIC) return redirect('//127.0.0.1/');
      return html('<p>no</p>');
    });

    const error = await refusal(PUBLIC_URL);

    expect(error.code).toBe('blocked_address');
    expect(requested).toEqual([PUBLIC_URL]);
  });

  it('re-resolves DNS on the redirected host rather than trusting the first hop', async () => {
    dnsStub.set('second.example.net', ['192.168.4.4']);
    stubFetch((url) => {
      if (url.hostname === PUBLIC) return redirect('https://second.example.net/x');
      return html('<p>internal</p>');
    });

    const error = await refusal(PUBLIC_URL);

    expect(error.code).toBe('blocked_address');
    expect(requested).toEqual([PUBLIC_URL]);
  });

  it('handles a 301 the same way as a 302', async () => {
    stubFetch((url) => {
      if (url.hostname === PUBLIC) return redirect('http://10.0.0.5/', 301);
      return html('<p>no</p>');
    });

    const error = await refusal(PUBLIC_URL);

    expect(error.code).toBe('blocked_address');
    expect(requested).toEqual([PUBLIC_URL]);
  });
});

describe('fetchPublicPage — response handling', () => {
  it('refuses a non-HTML content type', async () => {
    stubFetch(
      () => new Response('{"not":"a page"}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const error = await refusal(PUBLIC_URL);
    expect(error.code).toBe('not_html');
  });

  it('refuses a response with no content type at all', async () => {
    // A string body would make undici set `text/plain` for us; a null body is
    // the only way to get a genuinely absent content type.
    stubFetch(() => new Response(null, { status: 200 }));

    const error = await refusal(PUBLIC_URL);
    expect(error.code).toBe('not_html');
  });

  it('accepts application/xhtml+xml, which contains "html"', async () => {
    stubFetch(
      () => new Response('<html><body>x</body></html>', {
        status: 200,
        headers: { 'content-type': 'application/xhtml+xml' },
      }),
    );

    await expect(fetchPublicPage(PUBLIC_URL)).resolves.toMatchObject({
      finalUrl: PUBLIC_URL,
    });
  });

  it('reports an HTTP error status as fetch_failed', async () => {
    stubFetch(() => new Response('nope', { status: 404 }));

    const error = await refusal(PUBLIC_URL);
    expect(error.code).toBe('fetch_failed');
  });

  it('refuses a body larger than the 2 MB cap', async () => {
    const chunk = new Uint8Array(256 * 1024).fill(0x61); // 'a'
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        // Well past the cap, and enqueued lazily so the reader has to be the
        // thing that stops — a buffered 3 MB string would not test the cap.
        if (sent >= 3 * 1024 * 1024) {
          controller.close();
          return;
        }
        sent += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });

    stubFetch(
      () => new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    );

    const error = await refusal(PUBLIC_URL);
    expect(error.code).toBe('too_large');
  });

  it('accepts a body comfortably under the cap', async () => {
    const page = `<html><body>${'x'.repeat(1024 * 1024)}</body></html>`;
    stubFetch(() => html(page));

    const result = await fetchPublicPage(PUBLIC_URL);
    expect(result.html).toHaveLength(page.length);
  });

  it('gives up with a timeout when the response never completes', async () => {
    // The stub honours the abort signal the way a real socket would; without
    // that, this test would hang rather than assert anything.
    stubFetch(
      (_url, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
        });
      }),
    );

    vi.useFakeTimers();
    try {
      const pending = fetchPublicPage(PUBLIC_URL);
      const caught = pending.catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(8_000);
      const error = await caught;

      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('timeout');
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports a transport-level failure as fetch_failed, not a crash', async () => {
    stubFetch(() => {
      throw new TypeError('fetch failed');
    });

    const error = await refusal(PUBLIC_URL);
    expect(error.code).toBe('fetch_failed');
    expect(error.status).toBe(400);
  });

  it('identifies itself honestly rather than impersonating a browser', async () => {
    let seen: Record<string, string> = {};
    stubFetch((_url, init) => {
      seen = (init?.headers ?? {}) as Record<string, string>;
      return html('<p>ok</p>');
    });

    await fetchPublicPage(PUBLIC_URL);

    expect(seen['User-Agent']).toContain('ManzilRecipeVault');
    expect(seen['User-Agent']).not.toMatch(/Mozilla/i);
  });
});
