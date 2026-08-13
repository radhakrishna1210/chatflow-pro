import { prisma } from '../lib/prisma.js';

// ─── Intent routing ──────────────────────────────────────────────────────────
//
// An intent is a named thing customers ask for, the phrases that signal it, and
// where a matching message should go. It sits in front of the AI agent: a match
// routes deterministically and only what falls through reaches the model.
//
// Matching here is lexical and explainable on purpose. The workspace's LLM
// already handles open-ended understanding once a message falls through; what
// this layer owes the user is a decision they can predict from the phrases they
// typed, and a confidence they can reason about when they move the threshold.
// A model call would make both of those unanswerable — and would put a network
// round trip in front of every inbound message.

const clamp01 = (n) => Math.max(0, Math.min(1, n));

const asPhrases = (value) => (Array.isArray(value) ? value : [])
  .map((p) => String(p || '').trim())
  .filter(Boolean)
  .slice(0, 40);

const normalise = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

const tokens = (s) => normalise(s).split(' ').filter(Boolean);

// How well one phrase matches a message, 0–1.
//
// Three tiers, deliberately coarse: the whole phrase present as a substring is
// the strongest signal a user can give without writing a regex; otherwise the
// score is the share of the phrase's words the message contains, which is what
// makes "do you have size 9" match the phrase "do you have" at 1.0 and the
// phrase "size chart" at 0.5.
function phraseScore(message, phrase) {
  const m = normalise(message);
  const p = normalise(phrase);
  if (!m || !p) return 0;
  if (m.includes(p)) return 1;

  const pw = tokens(p);
  if (pw.length === 0) return 0;
  const mw = new Set(tokens(m));
  const hits = pw.filter((w) => mw.has(w)).length;
  if (hits === 0) return 0;
  // A single shared word out of many is weak evidence; scale it down so a
  // one-word overlap never clears a mid-range threshold on its own.
  return clamp01((hits / pw.length) * (hits === 1 && pw.length > 1 ? 0.6 : 1));
}

// Best-matching active rule for a message, with the phrase that won and the
// confidence it won by. Returns null when nothing scores above zero.
export function matchIntent(message, rules) {
  let best = null;
  for (const rule of rules) {
    if (!rule.isActive) continue;
    for (const phrase of asPhrases(rule.phrases)) {
      const score = phraseScore(message, phrase);
      if (score > 0 && (!best || score > best.confidence)) {
        best = { rule, phrase, confidence: score };
      }
    }
  }
  return best;
}

export async function listRules(workspaceId) {
  return prisma.intentRule.findMany({
    where: { workspaceId },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
}

function assertName(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) { const e = new Error('Intent name is required'); e.status = 400; throw e; }
  return trimmed.slice(0, 80);
}

export async function createRule(workspaceId, body = {}) {
  const name = assertName(body.name);
  const count = await prisma.intentRule.count({ where: { workspaceId } });
  try {
    return await prisma.intentRule.create({
      data: {
        workspaceId,
        name,
        icon: String(body.icon || '*').slice(0, 8),
        actionType: ['ai', 'human', 'trigger', 'workflow'].includes(body.actionType) ? body.actionType : 'ai',
        actionTarget: String(body.actionTarget || '').slice(0, 200),
        phrases: asPhrases(body.phrases),
        isActive: body.isActive !== false,
        sortOrder: Number.isInteger(body.sortOrder) ? body.sortOrder : count,
      },
    });
  } catch (err) {
    // The unique index is on (workspaceId, name) — a duplicate is a user
    // mistake, not a server fault, and should read like one.
    if (err?.code === 'P2002') {
      const e = new Error(`An intent called "${name}" already exists`);
      e.status = 409;
      throw e;
    }
    throw err;
  }
}

export async function updateRule(workspaceId, id, body = {}) {
  const existing = await prisma.intentRule.findFirst({ where: { id, workspaceId } });
  if (!existing) { const e = new Error('Intent not found'); e.status = 404; throw e; }

  const data = {};
  if (typeof body.name === 'string') data.name = assertName(body.name);
  if (typeof body.icon === 'string') data.icon = body.icon.slice(0, 8);
  if (['ai', 'human', 'trigger', 'workflow'].includes(body.actionType)) data.actionType = body.actionType;
  if (typeof body.actionTarget === 'string') data.actionTarget = body.actionTarget.slice(0, 200);
  if (Array.isArray(body.phrases)) data.phrases = asPhrases(body.phrases);
  if (typeof body.isActive === 'boolean') data.isActive = body.isActive;
  if (Number.isInteger(body.sortOrder)) data.sortOrder = body.sortOrder;

  try {
    return await prisma.intentRule.update({ where: { id }, data });
  } catch (err) {
    if (err?.code === 'P2002') {
      const e = new Error(`An intent called "${data.name}" already exists`);
      e.status = 409;
      throw e;
    }
    throw err;
  }
}

export async function deleteRule(workspaceId, id) {
  const existing = await prisma.intentRule.findFirst({ where: { id, workspaceId } });
  if (!existing) { const e = new Error('Intent not found'); e.status = 404; throw e; }
  await prisma.intentRule.delete({ where: { id } });
  return { ok: true };
}

// The live tester. Records nothing: a user trying phrasings in the tester would
// otherwise pollute the 30-day accuracy panel with traffic no customer sent.
export async function testMessage(workspaceId, message) {
  const sample = String(message || '').trim();
  if (!sample) { const e = new Error('message is required'); e.status = 400; throw e; }

  const [rules, ws] = await Promise.all([
    listRules(workspaceId),
    prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { intentMatchThreshold: true, intentMatchingEnabled: true },
    }),
  ]);

  const threshold = ws?.intentMatchThreshold ?? 0.6;
  const best = matchIntent(sample, rules);

  if (!best || best.confidence < threshold) {
    return {
      matched: false,
      threshold,
      enabled: ws?.intentMatchingEnabled === true,
      confidence: best ? best.confidence : 0,
      nearest: best ? { id: best.rule.id, name: best.rule.name, icon: best.rule.icon } : null,
      routedTo: 'AI agent (fell through)',
    };
  }

  return {
    matched: true,
    threshold,
    enabled: ws?.intentMatchingEnabled === true,
    confidence: best.confidence,
    matchedPhrase: best.phrase,
    intent: {
      id: best.rule.id,
      name: best.rule.name,
      icon: best.rule.icon,
      actionType: best.rule.actionType,
      actionTarget: best.rule.actionTarget,
    },
    routedTo: describeAction(best.rule),
  };
}

export function describeAction(rule) {
  switch (rule.actionType) {
    case 'human':    return rule.actionTarget ? `Human handoff · ${rule.actionTarget}` : 'Human handoff';
    case 'trigger':  return rule.actionTarget ? `Auto-reply · ${rule.actionTarget}` : 'Auto-reply';
    case 'workflow': return rule.actionTarget ? `Workflow · ${rule.actionTarget}` : 'Workflow';
    default:         return rule.actionTarget ? `AI agent · ${rule.actionTarget}` : 'AI agent';
  }
}

// Called from the inbound path when a real customer message is routed. Fire and
// forget: a failure to write the analytics row must never fail the reply.
export async function recordMatch(workspaceId, { intentRuleId = null, outcome, confidence = 0, sample = '' }) {
  try {
    await prisma.intentMatchEvent.create({
      data: {
        workspaceId,
        intentRuleId,
        outcome,
        confidence: clamp01(Number(confidence) || 0),
        sample: String(sample || '').slice(0, 280),
      },
    });
  } catch {
    /* analytics only */
  }
}

// The accuracy panel. Windowed to 30 days so it answers "how is routing doing
// lately", which is the question the number is next to.
export async function accuracy(workspaceId, days = 30) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await prisma.intentMatchEvent.groupBy({
    by: ['outcome'],
    where: { workspaceId, createdAt: { gte: since } },
    _count: { _all: true },
  });

  const counts = { MATCHED: 0, FELL_THROUGH: 0, MISMATCHED: 0 };
  for (const r of rows) {
    if (counts[r.outcome] !== undefined) counts[r.outcome] = r._count._all;
  }
  const total = counts.MATCHED + counts.FELL_THROUGH + counts.MISMATCHED;
  const pct = (n) => (total === 0 ? 0 : Math.round((n / total) * 1000) / 10);

  return {
    days,
    total,
    matched:     { count: counts.MATCHED,      pct: pct(counts.MATCHED) },
    fellThrough: { count: counts.FELL_THROUGH, pct: pct(counts.FELL_THROUGH) },
    mismatched:  { count: counts.MISMATCHED,   pct: pct(counts.MISMATCHED) },
  };
}

// Per-rule hit counts for the last 30 days, keyed by rule id — what the cards
// show under each intent.
export async function ruleHits(workspaceId, days = 30) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await prisma.intentMatchEvent.groupBy({
    by: ['intentRuleId'],
    where: { workspaceId, createdAt: { gte: since }, outcome: 'MATCHED', intentRuleId: { not: null } },
    _count: { _all: true },
  });
  return Object.fromEntries(rows.map((r) => [r.intentRuleId, r._count._all]));
}
