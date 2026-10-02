// Fetches and extracts structure from a customer-supplied website URL.
//
// SECURITY: this makes the server issue HTTP requests to an address the user
// controls, which is server-side request forgery unless every hop is checked.
// All of that lives in lib/safeUrl.js, shared with every other fetcher of
// customer-supplied URLs: each URL and redirect target is vetted, every address
// it resolves to must be public, and the connection is pinned to the address
// that was checked (no DNS-rebinding window). Responses are capped in size and
// time so a hostile host cannot exhaust the worker.

import { env } from '../config/env.js';
import { safeRequest, UnsafeUrlError } from './safeUrl.js';

export { ipIsPublic, assertSafeUrl } from './safeUrl.js';

const FETCH_TIMEOUT_MS = 8000;
const MAX_BYTES = 1_500_000;      // ~1.5 MB of HTML is far beyond any real page
const MAX_REDIRECTS = 3;
const MAX_PAGES = 6;              // homepage + up to 5 discovered key pages

// Identifies this deployment rather than a hardcoded marketing domain, so a
// site owner who finds it in their logs can trace it back to the service that
// actually made the request.
const USER_AGENT = `SpandanBot/1.0 (+${env.APP_URL || env.API_PUBLIC_URL}; website analysis for WhatsApp automation)`;

// ── Fetching ────────────────────────────────────────────────────────────────

export async function safeFetchHtml(rawUrl) {
  let response;
  try {
    response = await safeRequest(rawUrl, {
      timeout: FETCH_TIMEOUT_MS,
      maxBytes: MAX_BYTES,
      maxRedirects: MAX_REDIRECTS,
      // An oversized page is analysed from its first MAX_BYTES, as before.
      truncate: true,
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
    });
  } catch (err) {
    if (err instanceof UnsafeUrlError) throw err;
    const e = new Error(err.code === 'ECONNABORTED' ? 'That site took too long to respond' : 'Could not reach that site');
    e.status = 502; throw e;
  }

  if (response.status >= 300 && response.status < 400) {
    const e = new Error('That site redirected too many times'); e.status = 502; throw e;
  }
  if (response.status < 200 || response.status >= 300) {
    const e = new Error(`That site returned ${response.status}`); e.status = 502; throw e;
  }
  const type = String(response.headers['content-type'] || '');
  if (!/text\/html|application\/xhtml/i.test(type)) {
    const e = new Error('That URL did not return a web page'); e.status = 400; throw e;
  }
  return { html: response.data.toString('utf8'), finalUrl: response.url };
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
