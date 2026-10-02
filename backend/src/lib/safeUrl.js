// The one guard for every server-side request to an address a customer chose:
// outgoing webhooks, knowledge-source URLs, the website crawler and template
// media recovery.
//
// Any of these, unchecked, makes the server a proxy into its own network — the
// cloud metadata endpoint (169.254.169.254, IAM credentials), Redis and
// Postgres on the private network, localhost admin ports. Three layers:
//
//   1. assertSafeUrl: scheme, obviously-internal names and literal IPs, before
//      anything is resolved.
//   2. safeLookup: the DNS lookup the socket itself uses. Every address a name
//      resolves to must be public, and the connection is made to one of those
//      same addresses. Checking DNS and then letting the HTTP client resolve
//      again (the old crawler) leaves a rebinding window between the two.
//   3. safeRequest: never follows a redirect blindly; each hop goes through
//      1 and 2 again, and responses are capped in size and time.

import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import axios from 'axios';

export class UnsafeUrlError extends Error {
  constructor(message = 'That address is not publicly reachable') {
    super(message);
    this.name = 'UnsafeUrlError';
    this.status = 400;
    this.code = 'UNSAFE_URL';
  }
}

// ── Address classification ──────────────────────────────────────────────────

function ipv4IsPublic(ip) {
  const [a, b, c] = ip.split('.').map(Number);
  if (a === 0) return false;                           // "this network"
  if (a === 10) return false;                          // private
  if (a === 127) return false;                         // loopback
  if (a === 169 && b === 254) return false;            // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false;   // private
  if (a === 192 && b === 168) return false;            // private
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false; // IETF assignments, TEST-NET-1
  if (a === 100 && b >= 64 && b <= 127) return false;  // CGNAT
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a === 198 && b === 51 && c === 100) return false;  // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return false;   // TEST-NET-3
  if (a >= 224) return false;                          // multicast, reserved, broadcast
  return true;
}

// Expands an IPv6 literal to its eight 16-bit groups, including the forms with
// an embedded dotted IPv4 tail. Returns null for anything that is not one.
function ipv6Groups(ip) {
  let s = ip.toLowerCase().replace(/%.*$/, '');
  const v4 = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const p = v4[1].split('.').map(Number);
    s = s.slice(0, -v4[1].length) + `${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0) return null;
  const groups = [...head, ...Array(fill).fill('0'), ...tail].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => g >= 0 && g <= 0xffff) ? groups : null;
}

const v4From = (hi, lo) => `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;

function ipv6IsPublic(ip) {
  const g = ipv6Groups(ip);
  if (!g) return false;
  const [g0, g1] = g;
  const zeroTo = (n) => g.slice(0, n).every((x) => x === 0);

  if (zeroTo(8)) return false;                                   // ::
  if (zeroTo(7) && g[7] === 1) return false;                     // ::1
  // IPv4 carried inside IPv6 is judged as the IPv4 address it reaches.
  if (zeroTo(5) && g[5] === 0xffff) return ipv4IsPublic(v4From(g[6], g[7]));   // ::ffff:a.b.c.d
  if (zeroTo(4) && g[4] === 0xffff && g[5] === 0) return ipv4IsPublic(v4From(g[6], g[7])); // ::ffff:0:a.b.c.d
  if (zeroTo(6)) return ipv4IsPublic(v4From(g[6], g[7]));                      // ::a.b.c.d
  if (g0 === 0x64 && g1 === 0xff9b && g.slice(2, 6).every((x) => x === 0)) {
    return ipv4IsPublic(v4From(g[6], g[7]));                                   // NAT64
  }
  if (g0 === 0x2002) return ipv4IsPublic(v4From(g1, g[2]));                    // 6to4
  if ((g0 & 0xfe00) === 0xfc00) return false;                    // unique local
  if ((g0 & 0xffc0) === 0xfe80) return false;                    // link-local
  if ((g0 & 0xffc0) === 0xfec0) return false;                    // site-local (deprecated)
  if ((g0 & 0xff00) === 0xff00) return false;                    // multicast
  if (g0 === 0x2001 && g1 === 0x0db8) return false;              // documentation
  if (g0 === 0x2001 && g1 === 0) return false;                   // Teredo
  if (g0 === 0x0100 && zeroTo(4)) return false;                  // discard
  return true;
}

export function ipIsPublic(ip) {
  const host = String(ip || '').replace(/^\[|\]$/g, '');
  const version = net.isIP(host);
  if (version === 4) return ipv4IsPublic(host);
  if (version === 6) return ipv6IsPublic(host);
  return false;
}

// ── URL checks ──────────────────────────────────────────────────────────────

const INTERNAL_NAME = /(^|\.)(localhost|local|internal|localdomain|home\.arpa)$/i;

/**
 * Parses and vets a URL without touching the network. Returns the URL object
 * or throws UnsafeUrlError.
 */
export function assertSafeUrl(raw, { protocols = ['http:', 'https:'] } = {}) {
  let url;
  try {
    url = new URL(String(raw ?? '').trim());
  } catch {
    throw new UnsafeUrlError('That does not look like a valid URL');
  }
  if (!protocols.includes(url.protocol)) {
    throw new UnsafeUrlError(`Only ${protocols.map((p) => `${p}//`).join(' and ')} addresses are allowed`);
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host) throw new UnsafeUrlError('That URL has no hostname');
  if (INTERNAL_NAME.test(host)) throw new UnsafeUrlError();
  // A literal IP never reaches the DNS lookup, so it is judged here.
  if (net.isIP(host) && !ipIsPublic(host)) throw new UnsafeUrlError();
  return url;
}

/**
 * A dns.lookup replacement for the socket layer: resolves every address, and
 * fails unless all of them are public. Because the socket connects to what
 * this returns, the address that was checked is the address that is used.
 */
export function createSafeLookup(resolve = dns.lookup) {
  return function safeLookup(hostname, options, callback) {
    if (typeof options === 'function') { callback = options; options = {}; }
    const opts = typeof options === 'number' ? { family: options } : (options || {});
    resolve(hostname, { ...opts, all: true }, (err, addresses) => {
      if (err) return callback(err);
      const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: opts.family || 4 }];
      if (!list.length || list.some((a) => !ipIsPublic(a.address))) {
        const e = new UnsafeUrlError(`${hostname} resolves to an address that is not publicly reachable`);
        e.code = 'EUNSAFEADDR';
        return callback(e);
      }
      if (opts.all) return callback(null, list);
      return callback(null, list[0].address, list[0].family);
    });
  };
}

export const safeLookup = createSafeLookup();

// Resolves a hostname up front and rejects it if any address is private. Used
// where a URL is saved (so a bad one is refused when it is entered, not on the
// first event); the request itself is still guarded at connect time.
export async function assertResolvesPublic(rawUrl, opts) {
  const url = assertSafeUrl(rawUrl, opts);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) return url;
  await new Promise((resolve, reject) => {
    safeLookup(host, { all: true }, (err) => {
      if (!err) return resolve();
      reject(err instanceof UnsafeUrlError ? err : new UnsafeUrlError('That domain could not be resolved'));
    });
  });
  return url;
}

// ── Requests ────────────────────────────────────────────────────────────────

// keepAlive off: a pooled socket would be reused for a later request without
// a fresh lookup.
const httpAgent = new http.Agent({ lookup: safeLookup, keepAlive: false });
const httpsAgent = new https.Agent({ lookup: safeLookup, keepAlive: false });

async function readUpTo(stream, maxBytes) {
  if (!stream || typeof stream.on !== 'function') return Buffer.from(stream ?? []);
  const chunks = [];
  let total = 0;
  try {
    for await (const chunk of stream) {
      const remaining = maxBytes - total;
      if (chunk.length >= remaining) {
        chunks.push(chunk.subarray(0, remaining));
        break;
      }
      chunks.push(chunk);
      total += chunk.length;
    }
  } finally {
    stream.destroy();
  }
  return Buffer.concat(chunks);
}

/**
 * One HTTP request to a customer-chosen URL.
 *
 * Redirects are followed only up to `maxRedirects`, each hop re-vetted; with
 * the default of 0 a 3xx is returned to the caller as-is. The body is capped at
 * `maxBytes` (after decompression): past it the request fails, or with
 * `truncate` the body is cut off there instead. Never consults HTTP(S)_PROXY.
 *
 * @returns {Promise<{ status: number, headers: object, data: Buffer, url: string }>}
 */
export async function safeRequest(rawUrl, {
  method = 'GET',
  data,
  headers = {},
  timeout = 10_000,
  maxBytes = 2 * 1024 * 1024,
  maxRedirects = 0,
  truncate = false,
  protocols,
} = {}) {
  let url = assertSafeUrl(rawUrl, { protocols });

  for (let hop = 0; ; hop += 1) {
    let res;
    try {
      res = await axios.request({
        url: url.toString(),
        method,
        data,
        headers,
        timeout,
        maxRedirects: 0,
        maxContentLength: truncate ? -1 : maxBytes,
        responseType: truncate ? 'stream' : 'arraybuffer',
        validateStatus: () => true,
        httpAgent,
        httpsAgent,
        proxy: false,
      });
    } catch (err) {
      const cause = err?.cause ?? err;
      if (cause instanceof UnsafeUrlError || cause?.code === 'EUNSAFEADDR' || err?.code === 'EUNSAFEADDR') {
        throw new UnsafeUrlError();
      }
      throw err;
    }

    const location = res.headers?.location;
    if (res.status >= 300 && res.status < 400 && location && hop < maxRedirects) {
      if (truncate) res.data?.destroy?.();
      url = assertSafeUrl(new URL(location, url).toString(), { protocols });
      continue;
    }
    const body = truncate ? await readUpTo(res.data, maxBytes) : Buffer.from(res.data ?? []);
    return { status: res.status, headers: res.headers || {}, data: body, url: url.toString() };
  }
}
