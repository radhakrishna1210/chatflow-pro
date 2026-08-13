import { createHash } from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import { embedDocuments, embeddingsAvailable, EMBEDDING_DIM } from '../lib/embeddings.js';
import { MESSAGE_CATEGORY_RATES } from '../lib/messagePricing.js';
import * as site from '../data/siteContent.js';
import { HELP_DOCS } from '../data/helpContent.js';

// Builds and maintains the website assistant's knowledge index.
//
//   collect documents → chunk → hash → embed what changed → store
//
// The three sources are the marketing copy the landing page renders
// (data/siteContent.js), the how-to guides (data/helpContent.js), and the
// database itself for anything that has a live value — plan prices, quotas and
// limits, and the published per-message rate card.
//
// That last source is the point of the whole arrangement. Plan prices are
// edited in the Plan table, not in prose, so "what does Growth cost?" is
// answered from the same row the checkout charges against. There is no copy of
// the price anywhere in the corpus for the two to drift apart.

// ─── chunking ────────────────────────────────────────────────────────────────

// Chunks are small on purpose. Retrieval returns whole chunks, so a large one
// spends the model's attention on paragraphs that merely sat next to the
// answer — and with a handful of chunks in the prompt, precision matters more
// than recall. Paragraph boundaries are respected wherever a paragraph fits.
const TARGET_CHARS = 900;
const OVERLAP_CHARS = 140;

function splitSentences(text) {
  // Good enough for prose: break after ., ! or ? that is followed by a space
  // and a capital. Abbreviations occasionally escape, which costs nothing —
  // an over-long sentence is packed as-is rather than lost.
  return text.split(/(?<=[.!?])\s+(?=[A-Z(])/).filter(Boolean);
}

// Splits a document body into overlapping chunks. Overlap exists so a fact
// stated across a paragraph break is wholly present in at least one chunk.
export function chunkText(body) {
  const paragraphs = String(body).split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const pieces = [];
  for (const paragraph of paragraphs) {
    if (paragraph.length <= TARGET_CHARS) { pieces.push(paragraph); continue; }
    // An oversized paragraph is repacked from its sentences rather than cut
    // mid-word at the character limit.
    let buffer = '';
    for (const sentence of splitSentences(paragraph)) {
      if (buffer && buffer.length + sentence.length + 1 > TARGET_CHARS) {
        pieces.push(buffer);
        buffer = sentence;
      } else {
        buffer = buffer ? `${buffer} ${sentence}` : sentence;
      }
    }
    if (buffer) pieces.push(buffer);
  }

  const chunks = [];
  let current = '';
  for (const piece of pieces) {
    if (current && current.length + piece.length + 2 > TARGET_CHARS) {
      chunks.push(current);
      const tail = current.slice(-OVERLAP_CHARS);
      // Resume at a word boundary so the overlap does not open mid-word.
      const resumeAt = tail.indexOf(' ');
      const carried = resumeAt === -1 ? '' : tail.slice(resumeAt + 1);
      // Skip the overlap when the next piece is already at the size budget —
      // carrying context into a chunk that is full only makes it oversized,
      // and the piece stands on its own at that length anyway.
      current = carried && carried.length + piece.length + 2 <= TARGET_CHARS
        ? `${carried}\n\n${piece}`
        : piece;
    } else {
      current = current ? `${current}\n\n${piece}` : piece;
    }
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks : [String(body).trim()].filter(Boolean);
}

// ─── document collection ─────────────────────────────────────────────────────

function bulletList(items) {
  return items.map((item) => `- ${item}`).join('\n');
}

// The marketing site, as documents. Split by section rather than dumped as one
// page so a question about pricing does not retrieve the use-case grid.
function siteDocuments() {
  const docs = [];

  docs.push({
    id: 'site-overview',
    source: 'site',
    title: `What ${site.SITE_NAME} is`,
    topic: 'Overview',
    body: [
      `${site.SITE_NAME}: ${site.HERO.headline}`,
      site.HERO.sub,
      site.FOOTER_BLURB,
      bulletList(site.PROOF.map(([value, label]) => `${value} — ${label}`)),
      site.HERO.note,
    ].join('\n\n'),
  });

  docs.push({ id: 'site-about', source: 'site', title: `About ${site.SITE_NAME}`, topic: 'About', body: site.ABOUT });
  docs.push({ id: 'site-contact', source: 'site', title: `Contacting ${site.SITE_NAME}`, topic: 'Contact', body: site.CONTACT });

  // One document per feature: each is a self-contained claim about a distinct
  // capability, and merging them made "what does the AI agent do?" retrieve a
  // chunk that was half about Instagram.
  for (const feature of site.FEATURES) {
    docs.push({
      id: `site-feature-${slug(feature.title)}`,
      source: 'site',
      title: `Feature: ${feature.title}`,
      topic: 'Features',
      body: feature.desc,
    });
  }

  docs.push({
    id: 'site-feature-list',
    source: 'site',
    title: `${site.SITE_NAME} feature list`,
    topic: 'Features',
    // The roll-up exists for "what features do you have?", which wants the
    // whole list and matches no single feature document well.
    body: `${site.SITE_NAME} provides the following features:\n\n${bulletList(
      site.FEATURES.map((f) => `${f.title}: ${f.desc}`),
    )}`,
  });

  docs.push({
    id: 'site-use-cases',
    source: 'site',
    title: 'Industries and use cases',
    topic: 'Use cases',
    body: `${site.SITE_NAME} is used across these industries:\n\n${bulletList(
      site.USE_CASES.map((c) => `${c.title} (${c.metric}): ${c.desc}`),
    )}`,
  });

  // Plan marketing cards carry what a tier includes. They deliberately do NOT
  // carry the price — planDocuments() reads that from the Plan table, so the
  // display strings in PLAN_CARDS can never become an answer.
  for (const card of site.PLAN_CARDS) {
    docs.push({
      id: `site-plan-${slug(card.name)}`,
      source: 'site',
      title: `${card.name} plan — what it includes`,
      topic: 'Plans',
      body: [
        `The ${card.name} plan. ${card.desc}`,
        `Included in ${card.name}:\n${bulletList(card.features)}`,
        card.enquiry
          ? `${card.name} is not sold self-serve — pricing is bespoke and arranged through the "Talk to sales" button on the pricing page.`
          : `See the ${card.name} plan pricing document for its current price and quota.`,
      ].join('\n\n'),
    });
  }

  for (const [question, answer] of site.FAQ_ITEMS) {
    docs.push({
      id: `site-faq-${slug(question)}`,
      source: 'site',
      title: question,
      topic: 'FAQ',
      body: `Question: ${question}\n\nAnswer: ${answer}`,
    });
  }

  // ── The conversation reactor + platform map ──
  //
  // "What does it actually do, end to end?" and "what screens are there?" are
  // two of the most asked questions, and until these sections existed the site
  // had no single passage that answered either.
  docs.push({
    id: 'site-reactor',
    source: 'site',
    title: 'How Spandan works, end to end',
    topic: 'How it works',
    body: `${site.REACTOR.sub}

${bulletList(
      site.REACTOR.chapters.map((c) => `${c.title} ${c.body}`),
    )}`,
  });
  docs.push({
    id: 'site-platform-map',
    source: 'site',
    title: 'Every surface in the product',
    topic: 'Features',
    body: bulletList(
      site.PLATFORM_MAP.groups.map((g) => `${g.name}: ${g.items.join(', ')}`),
    ),
  });

  // ── Campaign AI product page ──
  //
  // Split the same way FEATURES is: the "what is it" answer and the "what are
  // its limits" answer are different questions, and one merged chunk answers
  // neither well. The page's own FAQ joins the site FAQ pool above, because a
  // visitor asking "will it make up a discount?" does not know or care which
  // page the answer was written for.
  const ca = site.CAMPAIGN_AI;
  docs.push({
    id: 'site-campaign-ai',
    source: 'site',
    title: 'Campaign AI',
    topic: 'Campaign AI',
    body: [ca.headline, ca.definition, bulletList(ca.chips)].join('\n\n'),
  });
  docs.push({
    id: 'site-campaign-ai-how',
    source: 'site',
    title: 'How Campaign AI works',
    topic: 'Campaign AI',
    body: `Campaign AI turns a one-way broadcast into a grounded conversation in four steps:\n\n${bulletList(
      ca.steps.map((s) => `${s.title}: ${s.body}`),
    )}`,
  });
  docs.push({
    id: 'site-campaign-ai-capabilities',
    source: 'site',
    title: 'What Campaign AI can do',
    topic: 'Campaign AI',
    body: bulletList(ca.capabilities.map((c) => `${c.title}: ${c.body}`)),
  });
  docs.push({
    id: 'site-campaign-ai-limits',
    source: 'site',
    title: 'Campaign AI limitations and compliance',
    topic: 'Campaign AI',
    body: `Limits a customer should know about Campaign AI:\n\n${bulletList(ca.limits)}`,
  });
  for (const [question, answer] of ca.faqs) {
    docs.push({
      id: `site-faq-${slug(question)}`,
      source: 'site',
      title: question,
      topic: 'FAQ',
      body: `Question: ${question}\n\nAnswer: ${answer}`,
    });
  }

  return docs;
}

function helpDocuments() {
  return HELP_DOCS.map((doc) => ({
    id: `help-${doc.id}`,
    source: 'help',
    title: doc.title,
    topic: doc.topic,
    body: doc.body,
  }));
}

// ─── live database content ───────────────────────────────────────────────────

function money(value, currency) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  const symbol = currency === 'INR' ? '₹' : `${currency} `;
  return `${symbol}${amount.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

// "up to 1 team members" reads as a bug to a customer and invites the model to
// reword it into something less exact, so the singular is spelled out.
function describeLimit(value, plural, singular) {
  if (value === null || value === undefined) return `unlimited ${plural}`;
  if (value === 1) return `1 ${singular}`;
  return `up to ${value.toLocaleString('en-IN')} ${plural}`;
}

// Plans, straight out of the table the checkout sells from. Written as prose
// rather than a JSON dump because the model has to quote these numbers back to
// a customer, and prose is what it reproduces faithfully.
async function planDocuments() {
  let plans;
  try {
    plans = await prisma.plan.findMany({ where: { isActive: true }, orderBy: { priceMonthly: 'asc' } });
  } catch (err) {
    // A database that cannot be read is not a reason to drop the rest of the
    // index — the site and help corpora are still worth having.
    console.error('[siteKnowledge] could not read plans:', err.message);
    return [];
  }

  const docs = plans.map((plan) => {
    const monthly = money(plan.priceMonthly, plan.currency);
    const quarterly = plan.priceQuarterly === null ? null : money(plan.priceQuarterly, plan.currency);
    const isFree = Number(plan.priceMonthly) === 0;

    const price = isFree
      ? `The ${plan.name} plan is free — there is no monthly charge and no card is required.`
      : `The ${plan.name} plan costs ${monthly} per month${quarterly ? `, or ${quarterly} per quarter` : ''}.`;

    const quota = plan.messageQuota === -1
      ? 'It includes unlimited messages per billing cycle.'
      : plan.messageQuota === 0
        ? 'It includes no messages — every message is charged to the workspace wallet.'
        : `It includes ${plan.messageQuota.toLocaleString('en-IN')} messages per billing cycle.`;

    const limits = [
      describeLimit(plan.contactLimit, 'contacts', 'contact'),
      describeLimit(plan.memberLimit, 'team members', 'team member'),
      describeLimit(plan.apiKeyLimit, 'API keys', 'API key'),
      describeLimit(plan.campaignLimit, 'campaigns', 'campaign'),
    ].join(', ');

    const enabled = Object.entries(plan.features || {})
      .filter(([, on]) => on)
      .map(([name]) => name);

    return {
      id: `plan-${plan.key.toLowerCase()}`,
      source: 'db',
      title: `${plan.name} plan pricing`,
      topic: 'Plans',
      body: [
        `${price} ${quota}`,
        `${plan.name} plan limits: ${limits}.`,
        enabled.length ? `Features enabled on ${plan.name}: ${enabled.join(', ')}.` : null,
        `Once the included messages are used up, further messages on ${plan.name} are charged to the workspace wallet at the plan's overage rate.`,
      ].filter(Boolean).join('\n\n'),
    };
  });

  if (plans.length) {
    docs.push({
      id: 'plan-catalog',
      source: 'db',
      title: 'All available plans and prices',
      topic: 'Plans',
      body: `${site.SITE_NAME} currently offers these plans:\n\n${bulletList(plans.map((plan) => {
        const monthly = Number(plan.priceMonthly) === 0 ? 'free' : `${money(plan.priceMonthly, plan.currency)} per month`;
        const quarterly = plan.priceQuarterly === null ? '' : ` (or ${money(plan.priceQuarterly, plan.currency)} per quarter)`;
        const quota = plan.messageQuota === -1 ? 'unlimited messages' : `${plan.messageQuota.toLocaleString('en-IN')} messages per cycle`;
        return `${plan.name}: ${monthly}${quarterly}, ${quota}`;
      }))}\n\nEnterprise pricing is bespoke and arranged through "Talk to sales" rather than bought from the site.`,
    });
  }

  return docs;
}

function rateCardDocument() {
  const lines = [
    ['MARKETING', 'Marketing', 'offers, launches and re-engagement'],
    ['UTILITY', 'Utility', 'order updates, reminders and receipts'],
    ['AUTHENTICATION', 'Authentication', 'one-time passcodes'],
  ].map(([key, label, usage]) => `- ${label} (${usage}): ₹${MESSAGE_CATEGORY_RATES[key]} per message`);

  return {
    id: 'message-rate-card',
    source: 'db',
    title: 'Per-message rates by category',
    topic: 'Pricing',
    body: `WhatsApp messages are charged per conversation category. These are the current published rates, and they are the same rates campaign launches are billed against:\n\n${lines.join('\n')}\n\nOn paid plans this is Meta's rate passed through without a markup. Message charges come out of the workspace wallet and are separate from the plan subscription fee.`,
  };
}

export async function collectDocuments() {
  return [
    ...siteDocuments(),
    ...helpDocuments(),
    ...(await planDocuments()),
    rateCardDocument(),
  ];
}

// ─── index sync ──────────────────────────────────────────────────────────────

function slug(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

// Covers the embedding parameters as well as the text, because a change to
// either invalidates the stored vector: vectors from a different model, or of
// a different width, cannot be compared with new ones.
function hashChunk(text) {
  return createHash('sha256')
    .update(`${env.GEMINI_EMBEDDING_MODEL}:${EMBEDDING_DIM}:${text}`)
    .digest('hex');
}

// What actually gets embedded. The title goes in front of the body so a chunk
// from the middle of a long guide still carries what it is about — without it,
// chunk 3 of "How to create and launch a campaign" is a list of steps with no
// indication that they are campaign steps.
export function embeddableText(chunk) {
  return `${chunk.title}\n\n${chunk.content}`;
}

function buildChunks(docs) {
  const chunks = [];
  for (const doc of docs) {
    const pieces = chunkText(doc.body);
    pieces.forEach((content, ordinal) => {
      chunks.push({
        ref: `${doc.id}#${ordinal}`,
        source: doc.source,
        docId: doc.id,
        title: doc.title,
        topic: doc.topic ?? null,
        content,
        contentHash: hashChunk(`${doc.title}\n\n${content}`),
      });
    });
  }
  return chunks;
}

// In-process cache of the index, so answering a question is one query at
// worst and usually none. Invalidated by syncIndex(); also expires on its own
// so a second instance's reindex is picked up without a restart.
//
// Keyed by scope: the platform corpus and each workspace's own website content
// live in one table but are never searched together, so they are cached (and
// invalidated) separately. A busy workspace's widget must not evict the
// landing page's index, and vice versa.
const CACHE_TTL_MS = 5 * 60 * 1000;
const caches = new Map(); // scopeKey -> { chunks, loadedAt }

// null (the platform corpus) and a workspace id have to be distinguishable as
// Map keys, hence the explicit sentinel rather than using null directly.
const scopeKey = (workspaceId) => workspaceId || '__platform__';

export function invalidateIndexCache(workspaceId = undefined) {
  // No argument clears everything — that is what a full reindex wants.
  if (workspaceId === undefined) caches.clear();
  else caches.delete(scopeKey(workspaceId));
}

export async function loadIndex(workspaceId = null) {
  const key = scopeKey(workspaceId);
  const held = caches.get(key);
  if (held && Date.now() - held.loadedAt < CACHE_TTL_MS) return held.chunks;

  let chunks = held?.chunks ?? null;
  try {
    chunks = await prisma.siteKnowledgeChunk.findMany({
      where: { workspaceId: workspaceId ?? null },
      select: { ref: true, source: true, docId: true, title: true, topic: true, content: true, embedding: true },
    });
  } catch (err) {
    // The expiry is only there to pick up a reindex done by another instance,
    // so a failed refresh costs freshness, not correctness — the copy in hand
    // is minutes old at worst. Failing a visitor's question over a transient
    // database blip, while holding a perfectly usable index in memory, would
    // be the worse trade. Only a cold cache has nothing to fall back on.
    if (!chunks) throw err;
    console.warn('[siteKnowledge] index refresh failed, serving cached copy:', err.message);
    // Restart the clock so a database that is properly down is retried on the
    // next interval rather than on every single question.
  }
  caches.set(key, { chunks, loadedAt: Date.now() });
  return chunks;
}

// Reconciles the stored index with the corpus as it is right now.
//
// Only chunks whose text changed are re-embedded; unchanged ones keep the
// vector they already have. That is what makes a boot-time sync affordable on
// a metered key — a restart with no content change costs zero embedding calls.
// `workspaceId` selects which corpus is being reconciled: null is the
// platform's own site/help content, a workspace id is that customer's website
// knowledge behind their Smart Website Widget. `documents` lets a caller supply
// the corpus instead of collecting the platform one, which is how the widget's
// knowledge sources reuse this incremental machinery rather than repeating it.
//
// Scoping the reads and the delete is load-bearing, not tidiness: this function
// removes every chunk it did not just build, so an unscoped sweep here would
// delete all customer knowledge every time the platform index synced on boot.
export async function syncIndex({ force = false, workspaceId = null, documents = null } = {}) {
  const started = Date.now();
  const docs = documents ?? await collectDocuments();
  const desired = buildChunks(docs);
  const desiredByRef = new Map(desired.map((chunk) => [chunk.ref, chunk]));

  const existing = await prisma.siteKnowledgeChunk.findMany({
    where: { workspaceId: workspaceId ?? null },
    select: { ref: true, contentHash: true, embedding: true },
  });
  const existingByRef = new Map(existing.map((row) => [row.ref, row]));

  const staleRefs = existing.filter((row) => !desiredByRef.has(row.ref)).map((row) => row.ref);

  // A chunk needs embedding when it is new, when its text moved, when a
  // previous sync could not reach the provider, or when the stored vector is
  // the wrong width for the current model.
  const needsEmbedding = desired.filter((chunk) => {
    if (force) return true;
    const row = existingByRef.get(chunk.ref);
    if (!row) return true;
    if (row.contentHash !== chunk.contentHash) return true;
    return !row.embedding?.length || row.embedding.length !== EMBEDDING_DIM;
  });

  let embedded = 0;
  const vectorByRef = new Map();
  if (needsEmbedding.length && embeddingsAvailable()) {
    const vectors = await embedDocuments(needsEmbedding.map(embeddableText));
    needsEmbedding.forEach((chunk, i) => {
      if (vectors[i]) { vectorByRef.set(chunk.ref, vectors[i]); embedded++; }
    });
  }

  let written = 0;
  for (const chunk of desired) {
    const row = existingByRef.get(chunk.ref);
    const vector = vectorByRef.get(chunk.ref);
    const textUnchanged = row && row.contentHash === chunk.contentHash;
    // Nothing to do: same text, and it already carries a usable vector.
    if (!force && textUnchanged && !vector && row.embedding?.length === EMBEDDING_DIM) continue;

    // When the text changed but embedding failed, the old vector must go —
    // searching new content through a stale vector is how a chunk gets
    // retrieved for a question it no longer answers.
    const embedding = vector ?? (textUnchanged ? (row?.embedding ?? []) : []);
    const data = {
      source: chunk.source,
      docId: chunk.docId,
      title: chunk.title,
      topic: chunk.topic,
      content: chunk.content,
      contentHash: chunk.contentHash,
      embedding: { set: embedding },
      embeddedAt: embedding.length ? new Date() : null,
    };
    await prisma.siteKnowledgeChunk.upsert({
      where: { ref: chunk.ref },
      create: { ref: chunk.ref, workspaceId: workspaceId ?? null, ...data, embedding },
      update: data,
    });
    written++;
  }

  if (staleRefs.length) {
    await prisma.siteKnowledgeChunk.deleteMany({
      where: { ref: { in: staleRefs }, workspaceId: workspaceId ?? null },
    });
  }

  invalidateIndexCache(workspaceId);

  const summary = {
    documents: docs.length,
    chunks: desired.length,
    written,
    removed: staleRefs.length,
    embedded,
    pendingEmbedding: needsEmbedding.length - embedded,
    ms: Date.now() - started,
  };
  console.log(
    `[siteKnowledge] ${workspaceId ? `workspace ${workspaceId}: ` : ''}`
    + `indexed ${summary.chunks} chunks from ${summary.documents} documents `
    + `(${summary.written} written, ${summary.removed} removed, ${summary.embedded} embedded, `
    + `${summary.pendingEmbedding} awaiting embedding) in ${summary.ms}ms`,
  );
  return summary;
}

export async function indexStatus() {
  const [total, withVector, newest] = await Promise.all([
    prisma.siteKnowledgeChunk.count(),
    prisma.siteKnowledgeChunk.count({ where: { embeddedAt: { not: null } } }),
    prisma.siteKnowledgeChunk.findFirst({ orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } }),
  ]);
  return {
    chunks: total,
    embeddedChunks: withVector,
    // False here is not an outage: retrieval falls back to lexical scoring.
    semanticSearch: withVector > 0,
    embeddingsConfigured: embeddingsAvailable(),
    embeddingModel: env.GEMINI_EMBEDDING_MODEL,
    lastIndexedAt: newest?.updatedAt ?? null,
  };
}
