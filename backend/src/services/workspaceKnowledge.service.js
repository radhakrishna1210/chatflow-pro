import axios from 'axios';
import { prisma } from '../lib/prisma.js';
import { syncIndex, invalidateIndexCache } from './siteKnowledge.service.js';
import { embeddingsAvailable } from '../lib/embeddings.js';
import { extractDocumentText } from '../lib/documentText.js';

// The customer's own website knowledge — what their Smart Website Widget
// answers from.
//
// A KnowledgeSource is a page URL or a block of pasted text. Sources are the
// editable, inspectable thing (the dashboard shows what was indexed, when it
// was fetched and why a URL failed); chunks and embeddings are derived from
// them by the platform's existing indexer, which this file feeds rather than
// reimplements. syncIndex() already does incremental content-hash diffing, so
// re-indexing after editing one page re-embeds one page.

const MAX_SOURCES = 100;
const MAX_CONTENT_CHARS = 200_000;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_FETCH_BYTES = 4 * 1024 * 1024;

const fail = (message, status = 400) => { const e = new Error(message); e.status = status; throw e; };

// Refs must be unique across the whole SiteKnowledgeChunk table, which now
// holds every workspace's corpus alongside the platform's. Namespacing the
// document id is what keeps two customers' "pricing" pages apart.
const docId = (workspaceId, sourceId) => `ws:${workspaceId}:${sourceId}`;

// ─── URL fetching ────────────────────────────────────────────────────────────

// Hosts a customer must not be able to point us at. Fetching runs server-side
// with the platform's network position, so an unchecked URL turns this feature
// into a request proxy into private infrastructure.
//
// Hostname-level only: it stops the obvious cases (localhost, RFC1918 literals,
// the cloud metadata endpoint) without a DNS round trip. A hostname that
// resolves to a private address still gets through, so this is a guard rail
// rather than a boundary — the fetcher is also capped in time and size, and
// only ever returns text to the workspace that asked for it.
const BLOCKED_HOST = /^(localhost|127\.|0\.|10\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$)/i;

export function assertFetchableUrl(raw) {
  let parsed;
  try {
    parsed = new URL(String(raw).trim());
  } catch {
    fail('That does not look like a valid URL.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    fail('Only http:// and https:// URLs can be indexed.');
  }
  if (BLOCKED_HOST.test(parsed.hostname)) {
    fail('That address is not reachable from the internet, so it cannot be indexed.');
  }
  return parsed.toString();
}

const ENTITIES = {
  '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
  '&#39;': "'", '&apos;': "'", '&mdash;': '—', '&ndash;': '–', '&hellip;': '…',
};

// Turns a page into the prose the indexer wants.
//
// Deliberately regex-based rather than a DOM parser: the goal is readable text
// for retrieval, not fidelity, and adding a parser dependency to strip tags
// would be the heaviest thing in this file. Block-level elements become line
// breaks so paragraph structure survives — the chunker splits on blank lines,
// so losing them would produce one giant unchunked blob.
export function htmlToText(html) {
  const source = String(html || '');
  const title = source.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
    ?? source.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
    ?? '';

  const text = source
    // The head carries the title, which is captured above and prepended to
    // every chunk by embeddableText() — leaving it in the body indexes it twice.
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, ' ')
    // Content that is markup, not prose.
    .replace(/<(script|style|noscript|svg|template)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    // Structure worth keeping as paragraph boundaries.
    .replace(/<\/(p|div|section|article|li|tr|h[1-6]|blockquote)>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? ' ')
    // Collapse the whitespace the tag stripping left behind, but keep the
    // blank lines that mark paragraphs.
    .split('\n')
    .map((line) => line.replace(/[ \t ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return {
    title: title.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(),
    text,
  };
}

// Fetches one page and returns its readable text. Never throws — a broken URL
// is a per-source status the dashboard shows, not something that should fail
// the whole re-index.
export async function fetchSourceContent(url) {
  try {
    const target = assertFetchableUrl(url);
    const res = await axios.get(target, {
      timeout: FETCH_TIMEOUT_MS,
      maxContentLength: MAX_FETCH_BYTES,
      maxRedirects: 3,
      responseType: 'text',
      // Some sites serve a different (or no) page to an unrecognised client.
      headers: { 'User-Agent': 'SpandanBot/1.0 (+website widget indexer)', Accept: 'text/html,*/*' },
      validateStatus: (s) => s >= 200 && s < 400,
    });
    const type = String(res.headers?.['content-type'] || '');
    if (type && !/text\/html|text\/plain|application\/xhtml/i.test(type)) {
      return { ok: false, error: `That URL returned ${type.split(';')[0]}, which has no text to index.` };
    }
    const { title, text } = htmlToText(res.data);
    if (!text || text.length < 40) {
      return { ok: false, error: 'That page had no readable text — it may render entirely in JavaScript.' };
    }
    return { ok: true, title, content: text.slice(0, MAX_CONTENT_CHARS) };
  } catch (err) {
    if (err.status) return { ok: false, error: err.message };
    const status = err.response?.status;
    return {
      ok: false,
      error: status ? `The page responded ${status}.` : (err.code === 'ECONNABORTED' ? 'The page took too long to respond.' : `Could not fetch that page: ${err.message}`),
    };
  }
}

// ─── sources ─────────────────────────────────────────────────────────────────

export async function listSources(workspaceId) {
  const sources = await prisma.knowledgeSource.findMany({
    where: { workspaceId },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true, kind: true, url: true, title: true, status: true, error: true,
      fetchedAt: true, createdAt: true, updatedAt: true,
      // The body can be very large; the list only needs to say how much there is.
      content: true,
    },
  });
  return sources.map(({ content, ...rest }) => ({ ...rest, chars: content.length }));
}

export async function getSource(workspaceId, id) {
  const source = await prisma.knowledgeSource.findFirst({ where: { id, workspaceId } });
  if (!source) fail('Knowledge source not found', 404);
  return source;
}

export async function createSource(workspaceId, { kind, url, title, content }) {
  const count = await prisma.knowledgeSource.count({ where: { workspaceId } });
  if (count >= MAX_SOURCES) fail(`A workspace can index at most ${MAX_SOURCES} sources.`);

  if (kind === 'url') {
    const target = assertFetchableUrl(url);
    const existing = await prisma.knowledgeSource.findFirst({ where: { workspaceId, url: target } });
    if (existing) fail('That URL is already indexed.', 409);
    const created = await prisma.knowledgeSource.create({
      data: { workspaceId, kind: 'url', url: target, title: title?.trim() || target, status: 'PENDING' },
    });
    // Fetched immediately so the user sees whether the URL worked, rather than
    // finding out at re-index time.
    return refreshSource(workspaceId, created.id);
  }

  const body = String(content || '').trim();
  if (!body) fail('Paste the text you want the assistant to know.');
  return prisma.knowledgeSource.create({
    data: {
      workspaceId, kind: 'text', title: String(title || '').trim() || 'Untitled note',
      content: body.slice(0, MAX_CONTENT_CHARS), status: 'READY', fetchedAt: new Date(),
    },
  });
}

// A document upload becomes an ordinary source: the text is extracted once at
// upload time and stored like pasted text, so chunking, embedding and the
// incremental re-index all work on it unchanged. The original file is not kept
// — the corpus needs the prose, not the PDF.
export async function createSourceFromDocument(workspaceId, { buffer, fileName, mimeType, title } = {}) {
  const count = await prisma.knowledgeSource.count({ where: { workspaceId } });
  if (count >= MAX_SOURCES) fail(`A workspace can index at most ${MAX_SOURCES} sources.`);

  const { text, label } = await extractDocumentText({ buffer, fileName, mimeType });

  return prisma.knowledgeSource.create({
    data: {
      workspaceId,
      kind: 'file',
      title: String(title || '').trim() || String(fileName || `Uploaded ${label}`).trim(),
      content: text.slice(0, MAX_CONTENT_CHARS),
      status: 'READY',
      fetchedAt: new Date(),
    },
  });
}

export async function updateSource(workspaceId, id, { title, content }) {
  const source = await getSource(workspaceId, id);
  const data = {};
  if (title !== undefined) data.title = String(title).trim() || source.title;
  if (content !== undefined && (source.kind === 'text' || source.kind === 'file')) {
    const body = String(content).trim();
    if (!body) fail('Text sources cannot be empty.');
    data.content = body.slice(0, MAX_CONTENT_CHARS);
    data.status = 'READY';
    data.fetchedAt = new Date();
  }
  return prisma.knowledgeSource.update({ where: { id }, data });
}

// Re-fetches a URL source. Text sources have nothing to refresh.
export async function refreshSource(workspaceId, id) {
  const source = await getSource(workspaceId, id);
  if (source.kind !== 'url') return source;

  const result = await fetchSourceContent(source.url);
  return prisma.knowledgeSource.update({
    where: { id },
    data: result.ok
      ? {
          content: result.content,
          // A page's own <title> beats the placeholder we stored on create,
          // but never overwrites a title the user typed themselves.
          title: source.title === source.url && result.title ? result.title : source.title,
          status: 'READY', error: null, fetchedAt: new Date(),
        }
      : { status: 'ERROR', error: result.error, fetchedAt: new Date() },
  });
}

export async function deleteSource(workspaceId, id) {
  await getSource(workspaceId, id);
  await prisma.knowledgeSource.delete({ where: { id } });
  // The chunks derived from it are removed by the next re-index, which the
  // caller triggers — doing it here would leave the index half-updated if the
  // caller then deletes a second source.
}

// ─── indexing ────────────────────────────────────────────────────────────────

// Rebuilds this workspace's slice of the knowledge index from its READY
// sources. Reuses the platform indexer wholesale: same chunker, same
// content-hash diffing, same embedding batching and quota handling.
export async function reindexWorkspace(workspaceId, { force = false, refresh = false } = {}) {
  if (refresh) {
    const urls = await prisma.knowledgeSource.findMany({
      where: { workspaceId, kind: 'url' }, select: { id: true },
    });
    for (const { id } of urls) await refreshSource(workspaceId, id);
  }

  const sources = await prisma.knowledgeSource.findMany({
    where: { workspaceId, status: 'READY' },
    orderBy: { createdAt: 'asc' },
  });

  const documents = sources
    .filter((s) => s.content.trim())
    .map((s) => ({
      id: docId(workspaceId, s.id),
      source: s.kind === 'url' ? 'website' : s.kind === 'file' ? 'document' : 'note',
      title: s.title,
      topic: s.url || null,
      body: s.content,
    }));

  const summary = await syncIndex({ workspaceId, documents, force });
  return { ...summary, sources: sources.length };
}

export async function knowledgeStatus(workspaceId) {
  const [chunks, embedded, sources, errored] = await Promise.all([
    prisma.siteKnowledgeChunk.count({ where: { workspaceId } }),
    prisma.siteKnowledgeChunk.count({ where: { workspaceId, embeddedAt: { not: null } } }),
    prisma.knowledgeSource.count({ where: { workspaceId } }),
    prisma.knowledgeSource.count({ where: { workspaceId, status: 'ERROR' } }),
  ]);
  return {
    sources,
    erroredSources: errored,
    chunks,
    embedded,
    // Without embeddings retrieval still works on BM25 alone, which is worth
    // saying plainly rather than letting the customer wonder why answers got
    // worse — see lib/embeddings.js.
    semantic: embeddingsAvailable() && embedded > 0,
    ready: chunks > 0,
  };
}

export { invalidateIndexCache };
