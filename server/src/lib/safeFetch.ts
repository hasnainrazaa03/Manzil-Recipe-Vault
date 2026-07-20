import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { AppError } from './errors.js';

/**
 * Fetches a user-supplied URL without turning the server into an SSRF proxy.
 *
 * Retrieving an arbitrary URL on a user's behalf hands them our network
 * position. From inside a cloud host that reaches the instance metadata service
 * (`169.254.169.254`, which on several providers hands out credentials), the
 * database on `localhost`, and anything else on the private network that
 * assumed it was unreachable.
 *
 * A naive allowlist check on the submitted URL is not enough, because a
 * perfectly public URL can redirect to `http://127.0.0.1` afterwards. Redirects
 * are therefore followed manually and every hop is re-validated.
 */

const MAX_REDIRECTS = 3;
const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 8_000;

/** Blocked IPv4 ranges, as [network, prefix length]. */
const BLOCKED_V4: [string, number][] = [
  ['0.0.0.0', 8], // "this" network
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local — cloud instance metadata lives here
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, includes broadcast
];

function v4ToInt(address: string): number | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;

  let value = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    value = (value << 8) | octet;
  }
  return value >>> 0;
}

function isBlockedV4(address: string): boolean {
  const value = v4ToInt(address);
  if (value === null) return true; // unparseable is not something to trust

  return BLOCKED_V4.some(([network, bits]) => {
    const base = v4ToInt(network);
    if (base === null) return false;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (value & mask) === (base & mask);
  });
}

/**
 * Expands an IPv6 address to its eight 16-bit groups.
 *
 * Necessary because textual matching on the compressed form is not sound:
 * `::ffff:127.0.0.1` is normalised by `new URL()` into `::ffff:7f00:1`, which
 * looks nothing like loopback to a regex but routes straight to it. Comparing
 * the actual bits is the only reliable way.
 */
function expandV6(address: string): number[] | null {
  let text = address.toLowerCase().replace(/^\[|\]$/g, '');
  if (text.includes('%')) text = text.slice(0, text.indexOf('%')); // zone id

  // A trailing dotted quad is the last two groups written in IPv4 form.
  let tail: number[] = [];
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (dotted?.[1]) {
    const value = v4ToInt(dotted[1]);
    if (value === null) return null;
    tail = [value >>> 16, value & 0xffff];
    text = text.slice(0, dotted.index);
    if (text.endsWith(':') && !text.endsWith('::')) text = text.slice(0, -1);
  }

  const halves = text.split('::');
  if (halves.length > 2) return null;

  const parse = (part: string): number[] | null => {
    if (part === '') return [];
    const groups: number[] = [];
    for (const chunk of part.split(':')) {
      if (chunk === '') continue;
      if (!/^[0-9a-f]{1,4}$/.test(chunk)) return null;
      groups.push(parseInt(chunk, 16));
    }
    return groups;
  };

  const head = parse(halves[0] ?? '');
  const rest = halves.length === 2 ? parse(halves[1] ?? '') : [];
  if (head === null || rest === null) return null;

  const known = [...head, ...rest, ...tail];
  if (known.length > 8) return null;

  if (halves.length === 2) {
    const gap = 8 - (head.length + rest.length + tail.length);
    if (gap < 0) return null;
    return [...head, ...Array<number>(gap).fill(0), ...rest, ...tail];
  }

  return known.length === 8 ? known : null;
}

function isBlockedV6(address: string): boolean {
  const groups = expandV6(address);
  if (!groups) return true; // unparseable is not something to trust

  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups as [
    number, number, number, number, number, number, number, number,
  ];

  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d): loopback and
  // every private range wearing an IPv6 hat. Unwrap and apply the IPv4 rules,
  // or all of them are bypassable simply by writing the address this way.
  const topIsZero = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0;
  if (topIsZero && (g5 === 0xffff || g5 === 0)) {
    const v4 = `${g6 >>> 8}.${g6 & 0xff}.${g7 >>> 8}.${g7 & 0xff}`;
    // `::` and `::1` land here too and are caught by the IPv4 rules for
    // 0.0.0.0/8 and 127.0.0.0/8 respectively.
    return isBlockedV4(v4);
  }

  if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g0 & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (g0 === 0x2001 && g1 === 0x0db8) return true; // documentation
  if (g0 === 0x0064 && g1 === 0xff9b) return true; // NAT64, wraps IPv4

  return false;
}

function isBlockedAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isBlockedV4(address);
  if (version === 6) return isBlockedV6(address);
  return true;
}

/**
 * Resolves a hostname and rejects it if *any* address it answers with is
 * private. Checking only the first would let a host that returns both a public
 * and a private address through.
 */
async function assertPublicHost(hostname: string): Promise<void> {
  /**
   * `new URL('http://[::1]/').hostname` keeps the brackets, and `isIP('[::1]')`
   * is 0 — so without stripping them an IPv6 literal falls through to a DNS
   * lookup instead of being recognised as an address. That lookup does fail
   * today, which means these were blocked *by accident* rather than by the
   * rule that is supposed to block them. Accidental defence stops working the
   * moment something upstream changes.
   */
  const bare = hostname.replace(/^\[|\]$/g, '');

  if (isIP(bare)) {
    if (isBlockedAddress(bare)) {
      throw new AppError(400, 'That address is not reachable from here', 'blocked_address');
    }
    return;
  }

  let addresses: { address: string }[];
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    throw new AppError(400, 'Could not find that website', 'dns_failed');
  }

  if (addresses.length === 0 || addresses.some((entry) => isBlockedAddress(entry.address))) {
    throw new AppError(400, 'That address is not reachable from here', 'blocked_address');
  }
}

function assertAllowedUrl(url: URL): void {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AppError(400, 'Only http and https links can be imported', 'bad_protocol');
  }
}

export interface FetchedPage {
  html: string;
  /** The URL actually fetched, after redirects — what should be attributed. */
  finalUrl: string;
}

/**
 * Retrieves a page as text, following redirects manually so each hop can be
 * revalidated.
 */
export async function fetchPublicPage(rawUrl: string): Promise<FetchedPage> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new AppError(400, 'That does not look like a valid link', 'invalid_url');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      assertAllowedUrl(url);
      await assertPublicHost(url.hostname);

      const response = await fetch(url, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          // Identifying ourselves honestly; some sites serve different markup
          // to unknown agents, and pretending to be a browser to get around
          // that would be the wrong kind of clever.
          'User-Agent': 'ManzilRecipeVault/1.0 (+recipe import)',
          Accept: 'text/html,application/xhtml+xml',
        },
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) throw new AppError(400, 'That link redirected nowhere', 'bad_redirect');

        // Re-enter the loop so the new host is validated too. This is the whole
        // reason redirects are handled by hand.
        url = new URL(location, url);
        continue;
      }

      if (!response.ok) {
        throw new AppError(400, `That page could not be read (${response.status})`, 'fetch_failed');
      }

      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.includes('html')) {
        throw new AppError(400, 'That link is not a web page', 'not_html');
      }

      const html = await readCapped(response, MAX_BYTES);
      return { html, finalUrl: url.toString() };
    }

    throw new AppError(400, 'That link redirected too many times', 'too_many_redirects');
  } catch (error) {
    if (error instanceof AppError) throw error;
    if ((error as Error).name === 'AbortError') {
      throw new AppError(400, 'That page took too long to respond', 'timeout');
    }
    throw new AppError(400, 'Could not reach that page', 'fetch_failed');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Reads a body up to a byte ceiling, aborting rather than buffering.
 * `Content-Length` is a claim, not a guarantee, so the cap is enforced against
 * the bytes that actually arrive.
 */
async function readCapped(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';

  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new AppError(400, 'That page is too large to import', 'too_large');
    }
    chunks.push(value);
  }

  return new TextDecoder('utf-8').decode(
    chunks.reduce((joined, chunk) => {
      const merged = new Uint8Array(joined.length + chunk.length);
      merged.set(joined);
      merged.set(chunk, joined.length);
      return merged;
    }, new Uint8Array(0)),
  );
}
