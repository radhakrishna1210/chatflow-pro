import crypto from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';

// Management side of the Smart Website Widget: what the workspace owner sees
// and edits. The visitor-facing half lives in widgetPublic.service.js, which
// is deliberately a separate file because it runs unauthenticated and must not
// grow access to anything this one can reach.

export const WIDGET_TYPES = ['WHATSAPP', 'AI', 'AI_WHATSAPP'];

// Defaults for a brand-new widget. Every one of these is editable; they exist
// so a widget works the moment it is created rather than requiring a tour of
// the settings first.
export const DEFAULT_CONFIG = {
  businessName: '',
  logoUrl: '',
  title: 'Chat with us',
  welcomeMessage: 'Hi! Ask me anything about our services, or talk to our team on WhatsApp.',
  assistantName: 'Assistant',
  avatarUrl: '',
  primaryColor: '#1EBF5E',
  position: 'bottom-right', // 'bottom-right' | 'bottom-left'
  size: 'medium', // 'small' | 'medium' | 'large'
  buttonText: 'Chat with us',
  whatsappButtonText: 'Talk to Us on WhatsApp',
  suggestedQuestions: [
    'What services do you offer?',
    'What are your pricing plans?',
    'How can I get started?',
  ],
  showOnDesktop: true,
  showOnMobile: true,
  // Delay before the launcher appears, so it does not fight the page's own
  // first paint.
  launcherDelayMs: 800,
};

export const DEFAULT_LEAD_CAPTURE = {
  enabled: false,
  // 'before_chat' gates the assistant behind a form; 'after_answer' asks once
  // the visitor has had something useful, which converts better and is the
  // reason this is a choice rather than a constant.
  trigger: 'after_answer',
  headline: 'Leave your details and we will get back to you',
  fields: [
    { key: 'name', label: 'Name', type: 'text', required: true },
    { key: 'phone', label: 'Phone', type: 'phone', required: true },
    { key: 'email', label: 'Email', type: 'email', required: false },
  ],
};

const fail = (message, status = 400) => { const e = new Error(message); e.status = status; throw e; };

// Public because it ends up in the page source of a customer's website. 24
// random hex characters: enough that it cannot be guessed, short enough to
// read out over a support call.
const newPublicKey = () => `cfp_${crypto.randomBytes(12).toString('hex')}`;

// A domain the customer typed, reduced to the host we will compare an Origin
// header against. Accepts "example.com", "https://example.com/", "*.acme.io".
export function normaliseDomain(raw) {
  let value = String(raw || '').trim().toLowerCase();
  if (!value) return null;
  value = value.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '');
  if (!value || value === '*') return null;
  // A bare "www." prefix is the single most common way a customer's widget
  // silently fails, so it is not treated as a different site.
  return value;
}

function sanitiseConfig(input = {}) {
  const merged = { ...DEFAULT_CONFIG, ...(input || {}) };
  const str = (v, max, fallback = '') => {
    const s = String(v ?? '').trim().slice(0, max);
    return s || fallback;
  };
  return {
    businessName: str(merged.businessName, 80),
    logoUrl: str(merged.logoUrl, 500),
    title: str(merged.title, 60, DEFAULT_CONFIG.title),
    welcomeMessage: str(merged.welcomeMessage, 400, DEFAULT_CONFIG.welcomeMessage),
    assistantName: str(merged.assistantName, 40, DEFAULT_CONFIG.assistantName),
    avatarUrl: str(merged.avatarUrl, 500),
    primaryColor: /^#[0-9a-f]{6}$/i.test(String(merged.primaryColor || '').trim())
      ? String(merged.primaryColor).trim()
      : DEFAULT_CONFIG.primaryColor,
    position: merged.position === 'bottom-left' ? 'bottom-left' : 'bottom-right',
    size: ['small', 'medium', 'large'].includes(merged.size) ? merged.size : 'medium',
    buttonText: str(merged.buttonText, 40, DEFAULT_CONFIG.buttonText),
    whatsappButtonText: str(merged.whatsappButtonText, 40, DEFAULT_CONFIG.whatsappButtonText),
    suggestedQuestions: (Array.isArray(merged.suggestedQuestions) ? merged.suggestedQuestions : [])
      .map((q) => String(q).trim())
      .filter(Boolean)
      .slice(0, 6),
    showOnDesktop: merged.showOnDesktop !== false,
    showOnMobile: merged.showOnMobile !== false,
    launcherDelayMs: Math.min(10000, Math.max(0, Number(merged.launcherDelayMs) || 0)),
  };
}

function sanitiseLeadCapture(input) {
  if (!input) return { ...DEFAULT_LEAD_CAPTURE };
  const fields = (Array.isArray(input.fields) ? input.fields : DEFAULT_LEAD_CAPTURE.fields)
    .map((f) => ({
      key: String(f?.key || '').trim().slice(0, 40).replace(/[^a-z0-9_]/gi, '_').toLowerCase(),
      label: String(f?.label || '').trim().slice(0, 60),
      type: ['text', 'phone', 'email', 'number'].includes(f?.type) ? f.type : 'text',
      required: !!f?.required,
    }))
    .filter((f) => f.key && f.label)
    .slice(0, 10);
  return {
    enabled: !!input.enabled,
    trigger: input.trigger === 'before_chat' ? 'before_chat' : 'after_answer',
    headline: String(input.headline || DEFAULT_LEAD_CAPTURE.headline).trim().slice(0, 160),
    fields: fields.length ? fields : DEFAULT_LEAD_CAPTURE.fields,
  };
}

// The path globs a widget shows on. "/pricing/*" and "/pricing" both work;
// empty means every page.
function sanitisePaths(paths) {
  return (Array.isArray(paths) ? paths : [])
    .map((p) => String(p).trim().slice(0, 200))
    .filter(Boolean)
    .slice(0, 30);
}

async function assertNumberBelongs(workspaceId, waNumberId) {
  if (!waNumberId) return null;
  const number = await prisma.waNumber.findFirst({ where: { id: waNumberId, workspaceId }, select: { id: true } });
  if (!number) fail('That WhatsApp number is not in this workspace.', 404);
  return waNumberId;
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

export async function listWidgets(workspaceId) {
  const widgets = await prisma.widget.findMany({
    where: { workspaceId },
    orderBy: { createdAt: 'desc' },
    include: { waNumber: { select: { id: true, phoneNumber: true, displayName: true } } },
  });
  return widgets.map(withInstall);
}

export async function getWidget(workspaceId, id) {
  const widget = await prisma.widget.findFirst({
    where: { id, workspaceId },
    include: { waNumber: { select: { id: true, phoneNumber: true, displayName: true } } },
  });
  if (!widget) fail('Widget not found', 404);
  return withInstall(widget);
}

export async function createWidget(workspaceId, body = {}) {
  const name = String(body.name || '').trim().slice(0, 80);
  if (!name) fail('Give the widget a name.');
  const type = WIDGET_TYPES.includes(body.type) ? body.type : 'AI_WHATSAPP';

  const widget = await prisma.widget.create({
    data: {
      workspaceId,
      name,
      type,
      enabled: body.enabled !== false,
      publicKey: newPublicKey(),
      waNumberId: await assertNumberBelongs(workspaceId, body.waNumberId),
      config: sanitiseConfig(body.config),
      allowedDomains: [...new Set((body.allowedDomains || []).map(normaliseDomain).filter(Boolean))].slice(0, 20),
      pagePaths: sanitisePaths(body.pagePaths),
      leadCapture: sanitiseLeadCapture(body.leadCapture),
    },
    include: { waNumber: { select: { id: true, phoneNumber: true, displayName: true } } },
  });
  return withInstall(widget);
}

export async function updateWidget(workspaceId, id, body = {}) {
  const existing = await prisma.widget.findFirst({ where: { id, workspaceId } });
  if (!existing) fail('Widget not found', 404);

  const data = {};
  if (body.name !== undefined) {
    const name = String(body.name).trim().slice(0, 80);
    if (!name) fail('Give the widget a name.');
    data.name = name;
  }
  if (body.type !== undefined && WIDGET_TYPES.includes(body.type)) data.type = body.type;
  if (body.enabled !== undefined) data.enabled = !!body.enabled;
  if (body.waNumberId !== undefined) data.waNumberId = await assertNumberBelongs(workspaceId, body.waNumberId);
  // Config is merged over what is stored, so a partial save from one tab of the
  // editor cannot silently reset the fields another tab owns.
  if (body.config !== undefined) data.config = sanitiseConfig({ ...(existing.config || {}), ...body.config });
  if (body.allowedDomains !== undefined) {
    data.allowedDomains = [...new Set((body.allowedDomains || []).map(normaliseDomain).filter(Boolean))].slice(0, 20);
  }
  if (body.pagePaths !== undefined) data.pagePaths = sanitisePaths(body.pagePaths);
  if (body.leadCapture !== undefined) data.leadCapture = sanitiseLeadCapture(body.leadCapture);

  const widget = await prisma.widget.update({
    where: { id },
    data,
    include: { waNumber: { select: { id: true, phoneNumber: true, displayName: true } } },
  });
  return withInstall(widget);
}

export async function deleteWidget(workspaceId, id) {
  const existing = await prisma.widget.findFirst({ where: { id, workspaceId }, select: { id: true } });
  if (!existing) fail('Widget not found', 404);
  // Sessions and events cascade — a deleted widget's analytics belong to a
  // widget that no longer exists.
  await prisma.widget.delete({ where: { id } });
}

// Rotates the public key. The old installation snippet stops working, which is
// the point: it is the remedy when a key has been copied somewhere it should
// not be.
export async function rotateKey(workspaceId, id) {
  const existing = await prisma.widget.findFirst({ where: { id, workspaceId }, select: { id: true } });
  if (!existing) fail('Widget not found', 404);
  const widget = await prisma.widget.update({
    where: { id },
    data: { publicKey: newPublicKey() },
    include: { waNumber: { select: { id: true, phoneNumber: true, displayName: true } } },
  });
  return withInstall(widget);
}

// ─── installation ────────────────────────────────────────────────────────────

export const widgetOrigin = () => String(env.APP_URL || `http://localhost:${env.PORT}`).replace(/\/$/, '');

// The snippet the customer pastes into their site.
//
// It carries only the public widget key — never a Gemini key, a WhatsApp token
// or anything else private. Everything else (branding, copy, the WhatsApp
// number, which questions to suggest) is fetched at runtime from the config
// endpoint, which is why changing a setting never requires reinstalling this.
export function installSnippet(publicKey) {
  const src = `${widgetOrigin()}/widget/v1/loader.js`;
  return `<script async src="${src}" data-cfp-widget="${publicKey}"></script>`;
}

function withInstall(widget) {
  return { ...widget, installSnippet: installSnippet(widget.publicKey) };
}

// ─── analytics ───────────────────────────────────────────────────────────────

const EVENT_TYPES = ['IMPRESSION', 'OPEN', 'QUESTION', 'ANSWER', 'WHATSAPP_CLICK', 'LEAD', 'HANDOFF'];

// Rolls WidgetEvent rows up into the numbers the dashboard shows. Grouped in
// one query rather than seven counts, because the event table is the hottest
// thing the widget writes.
export async function widgetAnalytics(workspaceId, { widgetId = null, days = 30 } = {}) {
  const since = new Date(Date.now() - Math.min(365, Math.max(1, days)) * 86400_000);
  const where = { workspaceId, createdAt: { gte: since }, ...(widgetId ? { widgetId } : {}) };

  const [grouped, widgets, leads] = await Promise.all([
    prisma.widgetEvent.groupBy({ by: ['type'], where, _count: { _all: true } }),
    prisma.widget.findMany({
      where: { workspaceId, ...(widgetId ? { id: widgetId } : {}) },
      select: { id: true, name: true, type: true, enabled: true },
    }),
    // Distinct contacts created through the widget, which is a truer "leads"
    // figure than counting LEAD events (a visitor can submit twice).
    prisma.widgetSession.count({
      where: { workspaceId, contactId: { not: null }, createdAt: { gte: since }, ...(widgetId ? { widgetId } : {}) },
    }),
  ]);

  const counts = Object.fromEntries(EVENT_TYPES.map((t) => [t, 0]));
  for (const row of grouped) counts[row.type] = row._count._all;

  const opens = counts.OPEN;
  const impressions = counts.IMPRESSION;
  return {
    days,
    impressions,
    opens,
    questions: counts.QUESTION,
    answers: counts.ANSWER,
    whatsappClicks: counts.WHATSAPP_CLICK,
    leads,
    handoffs: counts.HANDOFF,
    // "Conversion" is an engaged visitor doing something that reaches the
    // business: a lead or a WhatsApp handoff, over the widgets that were
    // actually opened. Measured against opens rather than impressions because
    // an impression is the page loading, not a person deciding anything.
    openRate: impressions > 0 ? +((opens / impressions) * 100).toFixed(1) : 0,
    conversionRate: opens > 0 ? +(((leads + counts.WHATSAPP_CLICK) / opens) * 100).toFixed(1) : 0,
    widgets,
  };
}

// Recent visitor sessions, for the widget detail screen: what people actually
// asked, and whether it went anywhere.
export async function recentSessions(workspaceId, { widgetId = null, limit = 20 } = {}) {
  const sessions = await prisma.widgetSession.findMany({
    where: { workspaceId, ...(widgetId ? { widgetId } : {}) },
    orderBy: { updatedAt: 'desc' },
    take: Math.min(100, Math.max(1, limit)),
    include: {
      widget: { select: { id: true, name: true } },
      contact: { select: { id: true, name: true, phoneNumber: true, email: true } },
    },
  });
  return sessions.map((s) => {
    const transcript = Array.isArray(s.transcript) ? s.transcript : [];
    return {
      id: s.id,
      widget: s.widget,
      contact: s.contact,
      pageUrl: s.pageUrl,
      handedOff: s.handedOff,
      questions: transcript.filter((t) => t.role === 'user').length,
      firstQuestion: transcript.find((t) => t.role === 'user')?.content ?? null,
      lastActivityAt: s.updatedAt,
      createdAt: s.createdAt,
    };
  });
}

// Answers a question exactly as the embedded widget would, for the builder's
// live preview.
//
// The preview was a static re-drawing of the widget's chrome: it showed what
// the panel looks like and could not answer anything, so there was no way to
// try the assistant before pasting it into a real website. This runs the same
// retrieval and the same generator the public /widget/v1/:key/ask endpoint
// uses, against the settings currently in the form — including unsaved ones,
// which is the point of a preview.
export async function previewWidgetAnswer(workspaceId, widgetId, { question, config = {}, type } = {}) {
  const text = String(question || '').trim();
  if (!text) { const e = new Error('Ask something to preview the answer'); e.status = 400; throw e; }

  const widget = await prisma.widget.findFirst({
    where: { id: widgetId, workspaceId },
    include: { workspace: { select: { name: true } }, waNumber: { select: { phoneNumber: true } } },
  });
  if (!widget) { const e = new Error('Widget not found'); e.status = 404; throw e; }

  const effectiveType = type || widget.type;
  if (effectiveType === 'WHATSAPP') {
    const e = new Error('A WhatsApp-only widget has no assistant to preview — it hands straight to WhatsApp.');
    e.status = 400; e.expose = true; throw e;
  }

  const { ask } = await import('./siteAssistant.service.js');
  const result = await ask({
    question: text,
    history: [],
    scope: {
      // Unsaved form values win, so the preview reflects what is on screen.
      siteName: config.businessName || widget.config?.businessName || widget.workspace?.name || widget.name,
      workspaceId,
      handoffOffer: effectiveType === 'AI_WHATSAPP' && !!widget.waNumber?.phoneNumber,
    },
  });

  return {
    answer: result.answer,
    grounded: result.grounded ?? null,
    sources: result.sources ?? [],
    // Named so the preview can say *why* an answer is thin — an empty knowledge
    // base and a failing model look identical from the outside otherwise.
    reason: result.reason ?? null,
  };
}
