// Fetches and extracts structure from a customer-supplied website URL.
//
// SECURITY: this makes the server issue HTTP requests to an address the user
// controls, which is server-side request forgery unless every hop is checked.
// A workspace admin could otherwise point it at 169.254.169.254 (cloud
// instance metadata — IAM credentials), at the Postgres/Redis hosts on the
// private network, or at localhost admin endpoints, and read the response
// back through the analysis output.
//
// Every URL — the original and each redirect target — is resolved to its IP
// and rejected if it lands anywhere non-public. Responses are capped in size
// and time so a hostile host cannot exhaust the worker.

import dns from 'node:dns/promises';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';
import { env } from '../config/env.js';

const FETCH_TIMEOUT_MS = 8000;
const MAX_BYTES = 1_500_000;      // ~1.5 MB of HTML is far beyond any real page
const MAX_REDIRECTS = 3;
const MAX_PAGES = 6;              // homepage + up to 5 discovered key pages

// Identifies this deployment rather than a hardcoded marketing domain, so a
// site owner who finds it in their logs can trace it back to the service that
// actually made the request.
const USER_AGENT = `SpandanBot/1.0 (+${env.APP_URL || env.API_PUBLIC_URL}; website analysis for WhatsApp automation)`;

// ── Address safety ──────────────────────────────────────────────────────────

function ipv4IsPublic(ip) {
  const [a, b, c] = ip.split('.').map(Number);
  if (a === 0) return false;                        // 0.0.0.0/8 "this network"
  if (a === 10) return false;                       // private
  if (a === 127) return false;                      // loopback
  if (a === 169 && b === 254) return false;         // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false;// private
  if (a === 192 && b === 168) return false;         // private
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false; // IETF assignments + TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return false;          // benchmarking
  if (a === 198 && b === 51 && c === 100) return false;           // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return false;            // TEST-NET-3
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
  if (a >= 224) return false;                       // multicast + reserved + broadcast
  return true;
}

// Expands an IPv6 address (any textual form, including an embedded dotted
// IPv4 tail) to its eight 16-bit groups, or null when it does not parse.
function ipv6Groups(ip) {
  let s = ip.toLowerCase().replace(/%.*$/, '');      // drop a zone id
  const v4 = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const p = v4[2].split('.').map(Number);
    if (p.some((n) => n > 255)) return null;
    s = `${v4[1]}${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0) return null;
  const groups = [...head, ...Array(fill).fill('0'), ...tail].map((g) => parseInt(g, 16));
  if (groups.length !== 8 || groups.some((g) => !Number.isInteger(g) || g < 0 || g > 0xffff)) return null;
  return groups;
}

const groupsToV4 = (hi, lo) => `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;

// Node's URL parser rewrites `[::ffff:127.0.0.1]` to `[::ffff:7f00:1]`, so a
// textual prefix check on "::ffff:a.b.c.d" let every IPv4 address through in
// hex form (http://[::ffff:7f00:1]:6379/ reached the local Redis). Checks are
// done on the parsed groups instead, and every IPv6 form that embeds an IPv4
// address (mapped, compatible, NAT64, 6to4) is judged by that address.
function ipv6IsPublic(ip) {
  const g = ipv6Groups(ip);
  if (!g) return false;
  const zero = (from, to) => g.slice(from, to).every((x) => x === 0);
  if (zero(0, 8)) return false;                                     // ::
  if (zero(0, 7) && g[7] === 1) return false;                       // ::1
  if (zero(0, 5) && g[5] === 0xffff) return ipv4IsPublic(groupsToV4(g[6], g[7])); // ::ffff:a.b.c.d
  if (zero(0, 6)) return ipv4IsPublic(groupsToV4(g[6], g[7]));      // ::a.b.c.d (deprecated compat)
  if (zero(0, 4) && g[4] === 0xffff && g[5] === 0) return false;    // ::ffff:0:a.b.c.d (SIIT)
  if (g[0] === 0x64 && g[1] === 0xff9b) return ipv4IsPublic(groupsToV4(g[6], g[7])); // NAT64
  if (g[0] === 0x2002) return ipv4IsPublic(groupsToV4(g[1], g[2])); // 6to4
  if (g[0] === 0x2001 && g[1] === 0) return false;                  // Teredo (tunnels to anywhere)
  if (g[0] === 0x2001 && g[1] === 0xdb8) return false;              // documentation
  if (g[0] === 0x100 && zero(1, 4)) return false;                   // discard-only
  if ((g[0] & 0xfe00) === 0xfc00) return false;                     // unique local fc00::/7
  if ((g[0] & 0xffc0) === 0xfe80) return false;                     // link-local fe80::/10
  if ((g[0] & 0xffc0) === 0xfec0) return false;                     // site-local fec0::/10
  if ((g[0] & 0xff00) === 0xff00) return false;                     // multicast
  return true;
}

export function ipIsPublic(ip) {
  const version = net.isIP(ip);
  if (version === 4) return ipv4IsPublic(ip);
  if (version === 6) return ipv6IsPublic(ip);
  return false;
}

const notPublic = (message = 'That address is not publicly reachable') => {
  const e = new Error(message); e.status = 400; return e;
};

// Parses and vets a URL. Returns the URL object, or throws with a message the
// UI can show. Rejects non-HTTP schemes outright: file:, gopher: and friends
// are how SSRF turns into local file disclosure.
export function assertSafeUrl(raw) {
  let url;
  try {
    url = new URL(String(raw).trim());
  } catch {
    const e = new Error('That does not look like a valid URL'); e.status = 400; throw e;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    const e = new Error('Only http:// and https:// addresses can be analysed'); e.status = 400; throw e;
  }
  if (!url.hostname) {
    const e = new Error('That URL has no hostname'); e.status = 400; throw e;
  }
  // Credentials in the URL would be sent to whatever host it names.
  if (url.username || url.password) throw notPublic('URLs with a username or password cannot be fetched');
  // Block the obvious names before paying for a DNS lookup.
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) {
    throw notPublic();
  }
  // A literal IP skips DNS, so check it here.
  if (net.isIP(host) && !ipIsPublic(host)) throw notPublic();
  return url;
}

// DNS lookup used for the actual connection. Resolving once to check and then
// letting the HTTP client resolve again is a DNS-rebinding window: a name with
// a 0-second TTL answers a public address to the check and 127.0.0.1 to the
// connect. Validating inside the socket's own lookup means the address that is
// checked is the address that is dialled. Every answer must be public, so a
// name that resolves to both a public and a private address is refused too.
export function safeLookup(hostname, options, callback) {
  if (typeof options === 'function') { callback = options; options = {}; }
  const opts = typeof options === 'number' ? { family: options } : (options || {});
  dns.lookup(hostname, { all: true, verbatim: true, family: opts.family || 0 })
    .then((addresses) => {
      if (!addresses.length) return callback(Object.assign(new Error('That domain could not be resolved'), { status: 400, code: 'ENOTFOUND' }));
      if (addresses.some(({ address }) => !ipIsPublic(address))) {
        return callback(notPublic('That address resolves to a private network and cannot be fetched'));
      }
      if (opts.all) return callback(null, addresses);
      return callback(null, addresses[0].address, addresses[0].family);
    })
    .catch(() => callback(Object.assign(new Error('That domain could not be resolved'), { status: 400, code: 'ENOTFOUND' })));
}

// ── Fetching ────────────────────────────────────────────────────────────────

function decoderFor(encoding) {
  const enc = String(encoding || '').trim().toLowerCase();
  if (enc === 'gzip' || enc === 'x-gzip') return zlib.createGunzip();
  if (enc === 'deflate') return zlib.createInflate();
  if (enc === 'br') return zlib.createBrotliDecompress();
  return null;
}

// One request, no redirect following, connecting only to addresses that pass
// safeLookup. Reads at most maxBytes of the (decoded) body.
function requestOnce(url, { headers, timeoutMs, maxBytes }) {
  return new Promise((resolve, reject) => {
    const mod = url.protocol === 'https:' ? https : http;
    let settled = false;
    const done = (fn, v) => { if (!settled) { settled = true; clearTimeout(timer); fn(v); } };
    const req = mod.request(url, {
      method: 'GET',
      headers: { 'Accept-Encoding': 'gzip, deflate, br', ...headers },
      lookup: safeLookup,
      // Never reuse a pooled socket: it would skip the lookup check.
      agent: false,
    }, (res) => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400) {
        res.resume();
        return done(resolve, { status, headers: res.headers, body: '' });
      }
      const decoder = decoderFor(res.headers['content-encoding']);
      const stream = decoder ? res.pipe(decoder) : res;
      const chunks = [];
      let total = 0;
      stream.on('data', (chunk) => {
        total += chunk.length;
        if (total > maxBytes) {
          chunks.push(chunk.subarray(0, Math.max(0, maxBytes - (total - chunk.length))));
          req.destroy();
          return done(resolve, { status, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') });
        }
        chunks.push(chunk);
      });
      stream.on('end', () => done(resolve, { status, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
      stream.on('error', (err) => done(reject, err));
    });
    const timer = setTimeout(() => {
      req.destroy(Object.assign(new Error('timeout'), { name: 'AbortError' }));
    }, timeoutMs);
    req.on('error', (err) => done(reject, err));
    req.end();
  });
}

// Fetches a public http(s) URL, following redirects by hand so every hop is
// re-validated (`redirect: 'follow'` would let a public URL bounce the request
// to a private one), with the connection itself pinned to a vetted address.
//
// Returns { status, headers, body, finalUrl }. Throws an Error with `status`
// (400 for an unsafe/invalid address, 502 for an unreachable site).
export async function safeFetch(rawUrl, {
  accept = 'text/html,application/xhtml+xml',
  userAgent = USER_AGENT,
  timeoutMs = FETCH_TIMEOUT_MS,
  maxBytes = MAX_BYTES,
  maxRedirects = MAX_REDIRECTS,
} = {}) {
  let url = assertSafeUrl(rawUrl);
  for (let hop = 0; hop <= maxRedirects; hop++) {
    let res;
    try {
      res = await requestOnce(url, { headers: { 'User-Agent': userAgent, Accept: accept }, timeoutMs, maxBytes });
    } catch (err) {
      if (err.status) throw err;  // refused by safeLookup
      const e = new Error(err.name === 'AbortError' ? 'That site took too long to respond' : 'Could not reach that site');
      e.status = 502; throw e;
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.location;
      if (!location) return { ...res, finalUrl: url.toString() };
      url = assertSafeUrl(new URL(location, url).toString());
      continue;
    }
    return { ...res, finalUrl: url.toString() };
  }
  const e = new Error('That site redirected too many times'); e.status = 502; throw e;
}

export async function safeFetchHtml(rawUrl) {
  const res = await safeFetch(rawUrl);
  if (res.status < 200 || res.status >= 300) {
    const e = new Error(`That site returned ${res.status}`); e.status = 502; throw e;
  }
  const type = String(res.headers['content-type'] || '');
  if (!/text\/html|application\/xhtml/i.test(type)) {
    const e = new Error('That URL did not return a web page'); e.status = 400; throw e;
  }
  return { html: res.body, finalUrl: res.finalUrl };
}

// ── Extraction ──────────────────────────────────────────────────────────────

const strip = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const decode = (s) => strip(s)
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

const attr = (tag, name) => {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, 'i'));
  return m ? m[1] : '';
};

// Text content with scripts, styles and markup removed. This is what the LLM
// reasons over, so it must not carry JS — an SPA shell would otherwise look
// like a page full of bundler noise.
function visibleText(html) {
  return decode(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' ')
  );
}

export function extractPage(html, pageUrl) {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const metaTags = html.match(/<meta\b[^>]*>/gi) || [];

  let description = '';
  let ogTitle = '';
  let ogType = '';
  for (const tag of metaTags) {
    const name = (attr(tag, 'name') || attr(tag, 'property')).toLowerCase();
    const content = decode(attr(tag, 'content'));
    if (!content) continue;
    if (!description && (name === 'description' || name === 'og:description')) description = content;
    if (!ogTitle && name === 'og:site_name') ogTitle = content;
    if (!ogType && name === 'og:type') ogType = content;
  }

  const headings = [];
  for (const level of [1, 2, 3]) {
    const re = new RegExp(`<h${level}[^>]*>([\\s\\S]*?)</h${level}>`, 'gi');
    let m;
    while ((m = re.exec(html)) && headings.length < 40) {
      const text = decode(m[1].replace(/<[^>]+>/g, ' '));
      if (text) headings.push({ level, text: text.slice(0, 160) });
    }
  }

  // JSON-LD is the highest-signal source when present: schema.org types name
  // the business outright (Restaurant, MedicalClinic, Hotel, Store…).
  const jsonLd = [];
  const ldRe = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let ld;
  while ((ld = ldRe.exec(html)) && jsonLd.length < 8) {
    try {
      const parsed = JSON.parse(ld[1].trim());
      for (const entry of Array.isArray(parsed) ? parsed : [parsed]) {
        if (entry && typeof entry === 'object') {
          jsonLd.push({
            type: entry['@type'], name: entry.name,
            description: typeof entry.description === 'string' ? entry.description.slice(0, 300) : undefined,
            telephone: entry.telephone, priceRange: entry.priceRange,
            address: entry.address?.addressLocality || entry.address?.addressRegion,
          });
        }
      }
    } catch { /* malformed JSON-LD is common; ignore it */ }
  }

  const links = [];
  const seenHref = new Set();
  const linkRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let a;
  while ((a = linkRe.exec(html)) && links.length < 250) {
    const href = attr(a[1], 'href');
    if (!href || href.startsWith('#') || /^(javascript|mailto|tel):/i.test(href)) {
      if (/^(mailto|tel):/i.test(href)) links.push({ href, text: decode(a[2].replace(/<[^>]+>/g, ' ')).slice(0, 80), contact: true });
      continue;
    }
    let abs;
    try { abs = new URL(href, pageUrl).toString(); } catch { continue; }
    if (seenHref.has(abs)) continue;
    seenHref.add(abs);
    links.push({ href: abs, text: decode(a[2].replace(/<[^>]+>/g, ' ')).slice(0, 80) });
  }

  const forms = (html.match(/<form\b[^>]*>/gi) || []).map((f) => ({
    action: attr(f, 'action'), method: (attr(f, 'method') || 'get').toLowerCase(),
  })).slice(0, 10);

  const inputNames = [...new Set(
    (html.match(/<input\b[^>]*>/gi) || [])
      .map((i) => attr(i, 'name') || attr(i, 'placeholder') || attr(i, 'type'))
      .filter(Boolean).map((s) => s.slice(0, 40))
  )].slice(0, 25);

  // Buttons and prominent links are the site's existing calls to action.
  const ctas = [...new Set(
    (html.match(/<button\b[^>]*>([\s\S]*?)<\/button>/gi) || [])
      .map((b) => decode(b.replace(/<[^>]+>/g, ' ')))
      .filter((t) => t && t.length < 40)
  )].slice(0, 20);

  const text = visibleText(html);

  return {
    url: pageUrl,
    title: decode(titleMatch?.[1] || ''),
    siteName: ogTitle,
    ogType,
    description,
    headings,
    jsonLd,
    links,
    forms,
    inputNames,
    ctas,
    text: text.slice(0, 6000),
    textLength: text.length,
  };
}

// Which discovered pages are worth a second request. Ordered by how much they
// tell us about the business model.
const PAGE_INTENTS = [
  ['pricing',     /\b(pricing|price|plans|packages|tariff|rates|fees)\b/i],
  ['services',    /\b(services|treatments|solutions|what-we-do|offerings|courses|menu)\b/i],
  ['products',    /\b(products|shop|store|collection|catalog|catalogue)\b/i],
  ['booking',     /\b(book|booking|appointment|schedule|reserve|reservation|consult)\b/i],
  ['contact',     /\b(contact|reach-us|enquiry|inquiry|get-in-touch)\b/i],
  ['about',       /\b(about|who-we-are|our-story|company)\b/i],
  ['faq',         /\b(faq|faqs|help|support|questions)\b/i],
];

export function pickKeyPages(homepage, origin) {
  const picked = new Map();
  for (const link of homepage.links) {
    if (!link.href || link.contact) continue;
    let u;
    try { u = new URL(link.href); } catch { continue; }
    if (u.origin !== origin) continue;                    // stay on the site
    if (/\.(pdf|jpg|jpeg|png|gif|svg|zip|mp4|webp|ico|css|js)$/i.test(u.pathname)) continue;
    const haystack = `${u.pathname} ${link.text}`;
    for (const [intent, re] of PAGE_INTENTS) {
      if (picked.has(intent)) continue;
      if (re.test(haystack)) { picked.set(intent, { intent, url: u.toString() }); break; }
    }
  }
  return [...picked.values()].slice(0, MAX_PAGES - 1);
}

// Crawls the homepage, then a handful of high-signal pages. Sub-page failures
// are non-fatal: a partial picture still beats refusing to analyse.
export async function crawlSite(rawUrl) {
  const { html, finalUrl } = await safeFetchHtml(rawUrl);
  const homepage = extractPage(html, finalUrl);
  const origin = new URL(finalUrl).origin;

  const targets = pickKeyPages(homepage, origin);
  const pages = [];
  const failures = [];

  const results = await Promise.allSettled(targets.map(async (t) => {
    const res = await safeFetchHtml(t.url);
    return { intent: t.intent, ...extractPage(res.html, res.finalUrl) };
  }));
  for (let i = 0; i < results.length; i++) {
    if (results[i].status === 'fulfilled') pages.push(results[i].value);
    else failures.push({ url: targets[i].url, reason: results[i].reason?.message || 'fetch failed' });
  }

  // An SPA shell renders almost nothing server-side. Say so, so the caller can
  // tell the user why the analysis is thin rather than silently guessing.
  const thin = homepage.textLength < 400 && homepage.headings.length < 3;

  return { origin, homepage, pages, failures, thin };
}
