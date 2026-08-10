import crypto from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { ask } from './siteAssistant.service.js';
import * as contactsService from './contacts.service.js';
import { normaliseDomain } from './widget.service.js';

// Everything the embedded widget on a customer's website is allowed to do.
//
// Separate from widget.service.js on purpose: every function here runs for an
// anonymous visitor on a third-party page, authenticated by nothing but a
// public widget key. It must therefore never return anything the key's owner
// would not publish — no tokens, no contact lists, no other widgets — and
// never accept a workspaceId from the caller. The widget row is the only
// source of workspace identity in this file.

const fail = (message, status = 400) => { const e = new Error(message); e.status = status; throw e; };

// Transcript kept per visitor. Long enough that a handoff carries real
// context, short enough that a bored visitor cannot grow a row without bound.
const MAX_TRANSCRIPT_TURNS = 20;

// ─── widget resolution and domain restriction ────────────────────────────────

export async function widgetByKey(publicKey) {
  const key = String(publicKey || '').trim();
  if (!key) fail('Missing widget key', 400);
  const widget = await prisma.widget.findUnique({
    where: { publicKey: key },
    include: {
      waNumber: { select: { id: true, phoneNumber: true } },
      workspace: { select: { id: true, name: true } },
    },
  });
  if (!widget) fail('Widget not found', 404);
  return widget;
}

// Does this request's Origin belong to a site allowed to run this widget?
//
// An empty allow-list means the customer has not restricted it yet. That is
// permitted (a widget has to work the moment it is installed, before the
// customer has necessarily filled the field in) but it is reported back in the
// config so the dashboard can warn — an unrestricted key is someone else's
// free AI quota.
export function originAllowed(widget, origin) {
  const allowed = Array.isArray(widget.allowedDomains) ? widget.allowedDomains : [];
  if (allowed.length === 0) return true;

  const host = normaliseDomain(origin);
  // A request with no Origin is not a browser on an allowed page — it is curl,
  // or a server. Once a customer has restricted the widget, that is refused.
  if (!host) return false;

  return allowed.some((entry) => {
    if (entry.startsWith('*.')) {
      const suffix = entry.slice(1); // ".acme.com"
      return host === entry.slice(2) || host.endsWith(suffix);
    }
    // "example.com" also authorises "www.example.com": treating those as
    // different sites is the most common way a correct install appears broken.
    return host === entry || host === `www.${entry}` || `www.${host}` === entry;
  });
}

export function assertOriginAllowed(widget, origin) {
  if (!originAllowed(widget, origin)) {
    fail('This widget is not authorised for this website.', 403);
  }
}

// ─── public config ───────────────────────────────────────────────────────────

// What the loader script fetches on every page load. Deliberately minimal: the
// branding and copy needed to render, the widget's capabilities, and a phone
// number that is already public (it is a click-to-chat destination). No token,
// no key, no workspace internals.
export async function publicConfig(widget) {
  const config = widget.config || {};
  const lead = widget.leadCapture || {};
  const wantsWhatsApp = widget.type === 'WHATSAPP' || widget.type === 'AI_WHATSAPP';

  return {
    key: widget.publicKey,
    enabled: widget.enabled,
    type: widget.type,
    name: widget.name,
    businessName: config.businessName || widget.workspace?.name || '',
    config: {
      logoUrl: config.logoUrl || '',
      title: config.title,
      welcomeMessage: config.welcomeMessage,
      assistantName: config.assistantName,
      avatarUrl: config.avatarUrl || '',
      primaryColor: config.primaryColor,
      position: config.position,
      size: config.size,
      buttonText: config.buttonText,
      whatsappButtonText: config.whatsappButtonText,
      suggestedQuestions: config.suggestedQuestions || [],
      showOnDesktop: config.showOnDesktop !== false,
      showOnMobile: config.showOnMobile !== false,
      launcherDelayMs: config.launcherDelayMs ?? 0,
    },
    pagePaths: widget.pagePaths || [],
    ai: widget.type === 'AI' || widget.type === 'AI_WHATSAPP',
    whatsapp: wantsWhatsApp && !!widget.waNumber?.phoneNumber,
    // The destination of a click-to-chat link, which is public by nature.
    whatsappNumber: wantsWhatsApp ? (widget.waNumber?.phoneNumber || null) : null,
    leadCapture: lead.enabled
      ? { enabled: true, trigger: lead.trigger, headline: lead.headline, fields: lead.fields || [] }
      : { enabled: false },
    // Surfaced so the dashboard can warn; harmless to the visitor.
    unrestricted: (widget.allowedDomains || []).length === 0,
  };
}

// ─── sessions ────────────────────────────────────────────────────────────────

export const newVisitorKey = () => `wv_${crypto.randomBytes(16).toString('hex')}`;

// Finds or creates the visitor's session. The key comes from the browser, so
// it is scoped to the widget on lookup — a key from one site cannot be used to
// read a session belonging to another widget.
export async function loadSession(widget, visitorKey, { pageUrl } = {}) {
  const key = String(visitorKey || '').trim();
  if (key) {
    const existing = await prisma.widgetSession.findFirst({
      where: { visitorKey: key, widgetId: widget.id },
    });
    if (existing) return existing;
  }
  return prisma.widgetSession.create({
    data: {
      widgetId: widget.id,
      workspaceId: widget.workspaceId,
      visitorKey: key || newVisitorKey(),
      pageUrl: String(pageUrl || '').slice(0, 500) || null,
      transcript: [],
    },
  });
}

const trimTranscript = (turns) => turns.slice(-MAX_TRANSCRIPT_TURNS);

// ─── analytics ───────────────────────────────────────────────────────────────

const EVENT_TYPES = new Set(['IMPRESSION', 'OPEN', 'QUESTION', 'ANSWER', 'WHATSAPP_CLICK', 'LEAD', 'HANDOFF']);

// Fire-and-forget: an analytics write must never be the reason a visitor's
// question fails.
export function recordEvent(widget, type, { visitorKey = null, meta = null } = {}) {
  if (!EVENT_TYPES.has(type)) return Promise.resolve(null);
  return prisma.widgetEvent.create({
    data: { widgetId: widget.id, workspaceId: widget.workspaceId, type, visitorKey, meta },
  }).catch((err) => {
    console.warn('[widget] event write failed:', err.message);
    return null;
  });
}

// ─── asking ──────────────────────────────────────────────────────────────────

// A visitor's question, answered from this workspace's indexed website content.
//
// The retrieval guard in siteAssistant.service.js is what keeps this from
// becoming a general-purpose chatbot on someone else's website: when the
// workspace's corpus does not cover the question, no model is called at all and
// the configured refusal is returned instead.
export async function askWidget(widget, { question, visitorKey, pageUrl } = {}) {
  if (widget.type === 'WHATSAPP') fail('This widget does not have an assistant.', 400);
  if (!widget.enabled) fail('This widget is turned off.', 403);

  const session = await loadSession(widget, visitorKey, { pageUrl });
  const history = Array.isArray(session.transcript) ? session.transcript : [];

  await recordEvent(widget, 'QUESTION', { visitorKey: session.visitorKey, meta: { question: String(question).slice(0, 300) } });

  const result = await ask({
    question,
    history,
    scope: {
      siteName: widget.config?.businessName || widget.workspace?.name || widget.name,
      workspaceId: widget.workspaceId,
      // When the corpus falls short, offer a person instead of a dead end —
      // but only if this widget actually has a WhatsApp number to hand off to.
      handoffOffer: widget.type === 'AI_WHATSAPP' && !!widget.waNumber?.phoneNumber,
    },
  });

  const transcript = trimTranscript([
    ...history,
    { role: 'user', content: String(question).slice(0, 1000) },
    { role: 'assistant', content: String(result.answer || '').slice(0, 1500) },
  ]);

  await prisma.widgetSession.update({
    where: { id: session.id },
    data: { transcript, pageUrl: session.pageUrl ?? (pageUrl ? String(pageUrl).slice(0, 500) : null) },
  });

  await recordEvent(widget, 'ANSWER', {
    visitorKey: session.visitorKey,
    meta: { grounded: result.grounded, reason: result.reason },
  });

  return {
    answer: result.answer,
    grounded: result.grounded,
    // `reason` tells the widget whether to surface the WhatsApp offer
    // prominently; the source list is not exposed, since chunk titles are the
    // customer's internal page structure.
    reason: result.reason,
    visitorKey: session.visitorKey,
    offerHandoff: !result.grounded && widget.type === 'AI_WHATSAPP' && !!widget.waNumber?.phoneNumber,
  };
}

// ─── WhatsApp handoff ────────────────────────────────────────────────────────

// The message the visitor arrives in WhatsApp already holding.
//
// Built from what they actually asked rather than a fixed "Hi, I'm interested"
// — the agent picking it up should be able to answer without asking the
// visitor to repeat themselves.
export function prefilledMessage(widget, session) {
  const transcript = Array.isArray(session?.transcript) ? session.transcript : [];
  const lastQuestion = [...transcript].reverse().find((t) => t.role === 'user')?.content;
  const business = widget.config?.businessName || widget.workspace?.name || 'your team';

  if (!lastQuestion) return `Hi ${business}, I have a question about your services.`;
  return `Hi ${business}, I was on your website and asked: "${String(lastQuestion).slice(0, 240)}". Could you help me with this?`;
}

// Records the handoff and returns the click-to-chat URL. The number is the
// workspace's configured WhatsApp Business number — never a hardcoded one.
export async function handoff(widget, { visitorKey, pageUrl } = {}) {
  if (widget.type === 'AI') fail('This widget does not offer WhatsApp.', 400);
  const phone = widget.waNumber?.phoneNumber;
  if (!phone) fail('No WhatsApp number is connected to this widget.', 409);

  const session = await loadSession(widget, visitorKey, { pageUrl });
  const text = prefilledMessage(widget, session);

  await prisma.widgetSession.update({ where: { id: session.id }, data: { handedOff: true } });
  await recordEvent(widget, 'WHATSAPP_CLICK', { visitorKey: session.visitorKey });
  await recordEvent(widget, 'HANDOFF', { visitorKey: session.visitorKey });

  // If the visitor already left their details we have a Contact, so the
  // handoff can be planted in the Inbox for an agent to see before the
  // visitor's first WhatsApp message even arrives.
  if (session.contactId) {
    await seedInboxContext(widget, session, { reason: 'whatsapp_handoff' }).catch((err) => {
      console.warn('[widget] inbox handoff context failed:', err.message);
    });
  }

  return {
    url: `https://wa.me/${String(phone).replace(/[^\d]/g, '')}?text=${encodeURIComponent(text)}`,
    message: text,
    visitorKey: session.visitorKey,
  };
}

// ─── lead capture ────────────────────────────────────────────────────────────

// A submitted lead becomes a Contact in the existing Contacts system — the
// same record the contact list, campaigns and the inbox all use. There is no
// separate lead table: a lead that cannot be messaged or segmented alongside
// every other contact is not worth capturing.
export async function captureLead(widget, { visitorKey, fields = {}, pageUrl } = {}) {
  const lead = widget.leadCapture || {};
  if (!lead.enabled) fail('Lead capture is not enabled for this widget.', 400);

  const defs = Array.isArray(lead.fields) ? lead.fields : [];
  const values = {};
  for (const def of defs) {
    const raw = String(fields?.[def.key] ?? '').trim().slice(0, 200);
    if (def.required && !raw) fail(`${def.label} is required.`);
    if (raw) values[def.key] = raw;
  }

  const phone = values.phone || values.phoneNumber || '';
  if (!phone) fail('A phone number is required to save this lead.');
  if (!contactsService.isValidPhone(phone)) fail('That phone number does not look valid.');

  const session = await loadSession(widget, visitorKey, { pageUrl });
  const normalised = contactsService.normalizePhone(phone);
  const name = values.name || normalised;
  const email = values.email || null;

  // Everything the widget knows that Contact has no column for — company, any
  // custom field the business added — is kept as tags, which is what the rest
  // of the app already filters and segments on.
  const extraTags = ['website-widget', ...
    Object.entries(values)
      .filter(([key]) => !['name', 'phone', 'phoneNumber', 'email'].includes(key))
      .map(([key, value]) => `${key}:${String(value).slice(0, 30)}`)
      .slice(0, 5),
  ];

  const existing = await prisma.contact.findFirst({
    where: { workspaceId: widget.workspaceId, phoneNumber: normalised },
  });

  let contact;
  if (existing) {
    // A returning visitor must not become a second contact, and must not lose
    // the tags or name they already had.
    contact = await prisma.contact.update({
      where: { id: existing.id },
      data: {
        name: existing.name && existing.name !== existing.phoneNumber ? existing.name : name,
        email: existing.email ?? email,
        tags: [...new Set([...(existing.tags || []), ...extraTags])].slice(0, 30),
      },
    });
  } else {
    contact = await contactsService.createContact(widget.workspaceId, {
      name, phoneNumber: normalised, email, tags: extraTags,
    });
  }

  await prisma.widgetSession.update({ where: { id: session.id }, data: { contactId: contact.id } });
  await recordEvent(widget, 'LEAD', { visitorKey: session.visitorKey, meta: { contactId: contact.id } });

  // The agent should see this in the Inbox with the visitor's questions
  // attached, not as a bare new contact.
  await seedInboxContext(widget, { ...session, contactId: contact.id }, { reason: 'lead_captured' })
    .catch((err) => console.warn('[widget] inbox lead context failed:', err.message));

  return { ok: true, visitorKey: session.visitorKey };
}

// ─── inbox integration ───────────────────────────────────────────────────────

// Puts the widget interaction into the existing Inbox, against the existing
// Conversation for this contact.
//
// Written as an inbound message rather than outbound: it is the visitor's side
// of the story, and an OUTBOUND row would claim the business had sent
// something over WhatsApp that it never sent. Nothing here touches Meta — it
// is context for the agent, not a delivered message.
async function seedInboxContext(widget, session, { reason }) {
  if (!session.contactId) return null;

  const waNumberId = widget.waNumberId
    ?? (await prisma.waNumber.findFirst({
      where: { workspaceId: widget.workspaceId },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    }))?.id
    ?? null;

  let conversation = await prisma.conversation.findFirst({
    where: { workspaceId: widget.workspaceId, contactId: session.contactId },
    orderBy: { lastMessageAt: 'desc' },
  });

  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: {
        workspaceId: widget.workspaceId,
        contactId: session.contactId,
        waNumberId,
        label: 'website',
        lastMessageAt: new Date(),
      },
    });
  }

  const transcript = Array.isArray(session.transcript) ? session.transcript : [];
  const asked = transcript.filter((t) => t.role === 'user').map((t) => `• ${t.content}`);

  const body = [
    `[Website Widget] ${widget.name}`,
    reason === 'lead_captured' ? 'A visitor left their details on the website.' : 'A visitor asked to continue on WhatsApp.',
    session.pageUrl ? `Page: ${session.pageUrl}` : null,
    asked.length ? `\nThey asked the assistant:\n${asked.slice(-5).join('\n')}` : '\nThey did not ask the assistant anything.',
  ].filter(Boolean).join('\n');

  await prisma.message.create({
    data: { conversationId: conversation.id, body, direction: 'INBOUND' },
  });

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: new Date(), unreadCount: { increment: 1 } },
  });

  return conversation;
}
