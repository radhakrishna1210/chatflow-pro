// Turns a business website into WhatsApp automation workflows.
//
// Pipeline: crawl (lib/siteCrawler.js) -> compact the pages into an evidence
// digest -> one LLM call that both classifies the business and proposes
// workflows -> normalise every proposed workflow into the exact node shape the
// workflow builder saves, so "Generate Workflow" is a single click with no
// second round trip.

import { GoogleGenAI } from '@google/genai';
import { env } from '../config/env.js';
import { crawlSite } from '../lib/siteCrawler.js';

let _ai = null;
let _aiKey = null;
function getAi() {
  const key = env.GEMINI_API_KEY;
  if (!key) return null;
  if (!_ai || _aiKey !== key) {
    _ai = new GoogleGenAI({ apiKey: key });
    _aiKey = key;
  }
  return _ai;
}

// Must match automation.service.js — the builder rejects anything else.
const ALLOWED_TRIGGER_SUBTYPES = new Set(['keyword', 'welcome', 'missed']);
const ALLOWED_ACTION_SUBTYPES = new Set(['message', 'delay', 'tag', 'agent']);

// A bare domain ("acme.com") is a URL to a person even without a scheme, so
// accept it and add https:// rather than falling through to prompt handling.
const URL_LIKE = /^(https?:\/\/)?((localhost|\[[0-9a-f:]+\]|(\d{1,3}\.){3}\d{1,3}|([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,})(:\d+)?)(\/\S*)?$/i;

// True only when the whole input is one URL. "Send a link to example.com when
// someone asks" is a workflow description that happens to mention a domain,
// and must keep using the existing generator.
export function detectUrl(input) {
  const trimmed = String(input || '').trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  if (!URL_LIKE.test(trimmed)) return null;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

// Compresses the crawl into something small enough to reason over without
// burning the context on boilerplate.
function buildDigest(crawl) {
  const { homepage, pages } = crawl;
  const section = (p, label) => [
    `--- ${label} (${p.url})`,
    p.title && `title: ${p.title}`,
    p.description && `meta: ${p.description}`,
    p.headings?.length && `headings: ${p.headings.slice(0, 14).map((h) => h.text).join(' | ')}`,
    p.ctas?.length && `buttons: ${p.ctas.join(' | ')}`,
    p.inputNames?.length && `form fields: ${p.inputNames.join(', ')}`,
    p.jsonLd?.length && `schema.org: ${JSON.stringify(p.jsonLd).slice(0, 400)}`,
    p.text && `text: ${p.text.slice(0, label === 'HOMEPAGE' ? 2500 : 1200)}`,
  ].filter(Boolean).join('\n');

  const navLinks = homepage.links
    .filter((l) => !l.contact && l.text)
    .slice(0, 40)
    .map((l) => l.text)
    .join(' | ');

  const contacts = homepage.links.filter((l) => l.contact).slice(0, 8).map((l) => l.href).join(', ');

  return [
    section(homepage, 'HOMEPAGE'),
    navLinks && `--- NAVIGATION\n${navLinks}`,
    contacts && `--- CONTACT LINKS\n${contacts}`,
    ...pages.map((p) => section(p, `PAGE:${p.intent.toUpperCase()}`)),
  ].filter(Boolean).join('\n\n').slice(0, 24000);
}

const SYSTEM_PROMPT = `You analyse a business website and design WhatsApp automation workflows for it.

Return JSON only. No markdown, no commentary.

Shape:
{
  "business": { "name": string, "industry": string, "summary": string },
  "analysis": {
    "primaryServices": string[], "products": string[], "targetCustomers": string[],
    "painPoints": string[], "customerJourney": string[], "leadSources": string[],
    "salesFunnel": string[], "faqs": string[], "commonIntents": string[],
    "bookingFlow": string, "supportFlow": string,
    "marketingOpportunities": string[], "retentionOpportunities": string[]
  },
  "recommended_workflows": [
    {
      "title": string,
      "description": string,
      "goal": string,
      "trigger": string,
      "benefit": string,
      "complexity": "Low" | "Medium" | "High",
      "nodes": [
        { "type": "trigger", "subtype": "keyword"|"welcome"|"missed", "value": string },
        { "type": "action", "subtype": "message"|"delay"|"tag"|"agent", "value": string }
      ]
    }
  ]
}

Rules:
- "industry" must be a specific category (Dental Clinic, Restaurant, Gym, Real Estate, SaaS, Law Firm, Hotel, Coaching, Ecommerce, Car Dealer, Interior Design, ...), not a generic word like "Business" or "Services".
- Base every field on evidence in the page content. Do not invent services, prices or locations that are not supported by the text.
- Produce 6 to 10 workflows chosen for THIS business. A dental clinic gets appointment booking and recall reminders; a restaurant gets table booking and delivery; an ecommerce store gets abandoned cart and order tracking. Do not emit generic filler.
- Every workflow: exactly one trigger node first, then 2 to 5 action nodes. Maximum 6 nodes total.
- trigger subtype "keyword": value is ONE uppercase word customers would actually send (BOOK, MENU, PRICE, REPORT). "welcome" and "missed" take an empty value.
- action "message": the exact WhatsApp text to send, under 300 characters, naming the real business and its real services. action "delay": a duration like "5 minutes" or "24 hours". action "tag": one short label. action "agent": the team to hand off to.
- Keyword values must be unique across workflows.
- "benefit" is a short concrete outcome ("Cuts no-shows by confirming 24h ahead"). "complexity" reflects node count and handoffs.`;

function coerceList(value, cap = 8) {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean).slice(0, cap);
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}

// Forces a model-proposed workflow into the builder's node contract. Anything
// that cannot be repaired is dropped rather than saved broken.
function normalizeWorkflow(raw, index, usedKeywords) {
  const title = String(raw?.title || '').trim().slice(0, 80);
  if (!title) return null;

  const source = Array.isArray(raw?.nodes) ? raw.nodes : Array.isArray(raw?.steps) ? raw.steps : [];
  const nodes = [];

  const triggerRaw = source.find((n) => n?.type === 'trigger');
  let triggerSubtype = String(triggerRaw?.subtype || 'keyword').toLowerCase();
  if (!ALLOWED_TRIGGER_SUBTYPES.has(triggerSubtype)) triggerSubtype = 'keyword';

  let triggerValue = '';
  if (triggerSubtype === 'keyword') {
    triggerValue = String(triggerRaw?.value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20)
      || title.split(/\s+/)[0].toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12)
      || `FLOW${index + 1}`;
    // Two workflows on the same keyword means the second can never fire.
    let candidate = triggerValue, n = 2;
    while (usedKeywords.has(candidate)) candidate = `${triggerValue}${n++}`.slice(0, 20);
    triggerValue = candidate;
    usedKeywords.add(triggerValue);
  }
  nodes.push({ id: 'step_1', type: 'trigger', subtype: triggerSubtype, value: triggerValue });

  for (const node of source) {
    if (nodes.length >= 6) break;
    if (node?.type === 'trigger') continue;
    let subtype = String(node?.subtype || 'message').toLowerCase();
    if (!ALLOWED_ACTION_SUBTYPES.has(subtype)) subtype = 'message';
    const value = String(node?.value || '').trim().slice(0, 900);
    if (!value) continue;
    nodes.push({ id: `step_${nodes.length + 1}`, type: 'action', subtype, value });
  }

  // A trigger with nothing after it is not a workflow.
  if (nodes.length < 2) return null;

  const complexity = ['Low', 'Medium', 'High'].includes(raw?.complexity)
    ? raw.complexity
    : nodes.length >= 5 ? 'High' : nodes.length >= 4 ? 'Medium' : 'Low';

  return {
    id: `wf_${index + 1}`,
    title,
    description: String(raw?.description || '').trim().slice(0, 300),
    goal: String(raw?.goal || '').trim().slice(0, 200),
    trigger: triggerSubtype === 'keyword' ? `Customer sends "${triggerValue}"` : `On ${triggerSubtype}`,
    benefit: String(raw?.benefit || '').trim().slice(0, 160),
    complexity,
    nodes,
    edges: [],
  };
}

function normalizeResult(raw, crawl, sourceUrl) {
  const usedKeywords = new Set();
  const workflows = (Array.isArray(raw?.recommended_workflows) ? raw.recommended_workflows : [])
    .map((w, i) => normalizeWorkflow(w, i, usedKeywords))
    .filter(Boolean)
    .slice(0, 12);

  const a = raw?.analysis || {};
  return {
    mode: 'website',
    sourceUrl,
    business: {
      name: String(raw?.business?.name || crawl?.homepage?.siteName || crawl?.homepage?.title || '').trim().slice(0, 120)
        || new URL(sourceUrl).hostname,
      industry: String(raw?.business?.industry || '').trim().slice(0, 80) || 'Unclassified',
      summary: String(raw?.business?.summary || crawl?.homepage?.description || '').trim().slice(0, 600),
    },
    analysis: {
      primaryServices: coerceList(a.primaryServices),
      products: coerceList(a.products),
      targetCustomers: coerceList(a.targetCustomers),
      painPoints: coerceList(a.painPoints),
      customerJourney: coerceList(a.customerJourney),
      leadSources: coerceList(a.leadSources),
      salesFunnel: coerceList(a.salesFunnel),
      faqs: coerceList(a.faqs, 10),
      commonIntents: coerceList(a.commonIntents),
      bookingFlow: String(a.bookingFlow || '').trim().slice(0, 400),
      supportFlow: String(a.supportFlow || '').trim().slice(0, 400),
      marketingOpportunities: coerceList(a.marketingOpportunities),
      retentionOpportunities: coerceList(a.retentionOpportunities),
    },
    recommendedWorkflows: workflows,
    pagesAnalysed: [crawl.homepage.url, ...crawl.pages.map((p) => p.url)],
    // Surfaced so the UI can explain a thin result instead of looking broken.
    partial: crawl.thin || crawl.failures.length > 0,
    notes: [
      crawl.thin && 'This site renders most of its content in the browser, so only limited text was readable.',
      crawl.failures.length > 0 && `${crawl.failures.length} linked page(s) could not be read.`,
    ].filter(Boolean),
  };
}

function parseJson(text) {
  const trimmed = String(text || '').trim();
  const fenced = trimmed.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(fenced); } catch { /* fall through */ }
  const start = fenced.indexOf('{');
  const end = fenced.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try { return JSON.parse(fenced.slice(start, end + 1)); } catch { /* give up */ }
  }
  return null;
}

// Crawls `url` and returns the business analysis plus ready-to-save workflows.
export async function analyseWebsite(url) {
  const crawl = await crawlSite(url);

  const ai = getAi();
  if (!ai) {
    const e = new Error('Website analysis needs a Gemini API key on the server. Describe your business in words instead and AI will build a workflow from that.');
    e.status = 503;
    e.expose = true;
    throw e;
  }

  const digest = buildDigest(crawl);
  if (digest.replace(/---.*/g, '').trim().length < 120) {
    const e = new Error('There was not enough readable content on that site to analyse. Describe your business in a sentence or two instead.');
    e.status = 422;
    throw e;
  }

  let response;
  try {
    response = await ai.models.generateContent({
      model: env.GEMINI_MODEL,
      contents: `${SYSTEM_PROMPT}\n\nWebsite: ${crawl.homepage.url}\n\nEvidence:\n${digest}`,
      config: { temperature: 0.4, responseMimeType: 'application/json' },
    });
  } catch (err) {
    console.error('[WebsiteAnalysis] Gemini error:', err.message);
    const e = new Error('The AI service could not analyse that site right now. Try again, or describe your business in words.');
    e.status = 502;
    throw e;
  }

  const parsed = parseJson(response.text);
  if (!parsed) {
    const e = new Error('The analysis came back in an unreadable format. Try again.');
    e.status = 502;
    throw e;
  }

  const result = normalizeResult(parsed, crawl, crawl.homepage.url);
  if (result.recommendedWorkflows.length === 0) {
    const e = new Error('No usable workflows could be built from that site. Try describing your business in words instead.');
    e.status = 422;
    throw e;
  }
  return result;
}
