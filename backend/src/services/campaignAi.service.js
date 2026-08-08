import { prisma } from '../lib/prisma.js';
import { llmText, llmAvailable } from '../lib/llm.js';
import { contactVariableResolver, fillVariables } from '../lib/templateParams.js';
import { sendAutomatedReply } from './outbound.service.js';

// ─────────────────────────────────────────────────────────────────────────────
// Campaign AI Agent
//
// The WhatsApp AI Agent (services/aiAgent.service.js) answers inbound messages
// as a last-resort fallback. This module gives it a second, sharper job: a
// campaign can carry a CTA button ("Ask Anything"), and tapping it hands that
// customer to the same agent primed with the campaign message they received —
// so "how much is it?" is answerable without the customer repeating anything.
//
// Three things make that work:
//   1. A snapshot. What the agent answers from is a copy of the message taken
//      at send time (CampaignRecipient.aiContext), falling back to the copy
//      taken at launch (Campaign.aiAgentContext). Editing the campaign or
//      re-syncing the template afterwards can never rewrite what a customer
//      who already received it is told.
//   2. A session. CampaignAiSession ties contact → campaign → recipient →
//      conversation → agent, and owns that conversation's replies until it
//      expires or the customer exits, which is what stops the generic fallback
//      agent from answering campaign questions with no campaign in front of it.
//   3. An identifier on the click. Template quick-reply buttons carry a
//      per-send payload, so the tap arrives naming the exact recipient row —
//      no guessing which campaign the customer means.
// ─────────────────────────────────────────────────────────────────────────────

// Meta caps button text at 25 characters (lib/templateButtons.js).
export const CTA_MAX_CHARS = 25;
export const DEFAULT_CTA_LABEL = 'Ask Anything';
export const CTA_PRESETS = ['Ask Anything', 'Have a Question?', 'Need Help?', 'Agent Support'];

// How long a campaign chat stays in charge of the conversation with no
// activity, refreshed on every turn. Matched to WhatsApp's own 24-hour
// customer-service window, because that is the period in which a free-form
// reply is possible at all — a shorter window buys nothing and silently drops
// the customer back to an agent that has never seen the campaign, which is
// exactly what made follow-up questions get answered blind.
export const SESSION_TTL_MINUTES = 24 * 60;

// How far back a typed CTA label is honoured when the template had no
// quick-reply button to carry a payload.
const TEXT_CTA_LOOKBACK_DAYS = 30;

// Conversation turns replayed to the model. Enough for the multi-turn
// "price? / till when? / discount?" pattern without pushing the campaign
// context out of a small model's attention.
const HISTORY_MESSAGES = 12;

const PAYLOAD_PREFIX = 'cfp_campaign_ai:';

// ─── CTA label ───────────────────────────────────────────────────────────────

export function normalizeCtaLabel(raw) {
  const text = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (!text) return DEFAULT_CTA_LABEL;
  return text.slice(0, CTA_MAX_CHARS);
}

// Comparison form for "did the customer type the CTA?" — case, spacing and
// trailing punctuation all vary between what the admin typed and what a phone
// keyboard produces.
const ctaKey = (value) => String(value ?? '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

// ─── Quick-reply payload ─────────────────────────────────────────────────────

export const campaignCtaPayload = (recipientId) => `${PAYLOAD_PREFIX}${recipientId}`;

export function parseCampaignCtaPayload(payload) {
  const text = String(payload ?? '');
  return text.startsWith(PAYLOAD_PREFIX) ? text.slice(PAYLOAD_PREFIX.length) || null : null;
}

const buttonsOf = (components) =>
  (Array.isArray(components) ? components : [])
    .find((c) => String(c?.type || '').toUpperCase() === 'BUTTONS')?.buttons || [];

// Which button on the approved template acts as the CTA. Meta will not accept
// buttons that were not approved with the template, so the campaign can only
// use a quick reply the template already has: the one whose label matches the
// configured CTA, else the first quick reply on the template.
export function findCtaButton(components, ctaLabel) {
  const buttons = buttonsOf(components);
  const wanted = ctaKey(ctaLabel);
  let fallback = null;

  for (let index = 0; index < buttons.length; index++) {
    const button = buttons[index];
    if (String(button?.type || '').toUpperCase() !== 'QUICK_REPLY') continue;
    if (wanted && ctaKey(button?.text) === wanted) return { index, text: String(button.text || '') };
    if (fallback === null) fallback = { index, text: String(button?.text || '') };
  }
  return fallback;
}

// The `components` entry that attaches our payload to that button on a send.
// Quick-reply buttons take no parameters otherwise, so this never collides
// with what buildButtonComponents() produces for URL/copy-code buttons.
export function campaignCtaComponent(components, { ctaLabel, recipientId }) {
  const button = findCtaButton(components, ctaLabel);
  if (!button || !recipientId) return null;
  return {
    type: 'button',
    sub_type: 'quick_reply',
    index: String(button.index),
    parameters: [{ type: 'payload', payload: campaignCtaPayload(recipientId) }],
  };
}

// ─── Campaign context snapshot ───────────────────────────────────────────────

const textOf = (components, type) =>
  (Array.isArray(components) ? components : [])
    .find((c) => String(c?.type || '').toUpperCase() === type && typeof c?.text === 'string')?.text || '';

// Everything the agent is allowed to know about this campaign, captured as
// plain data. `contact` is optional: at launch there is no single recipient, so
// the campaign-level snapshot keeps the template's own example values.
export function buildCampaignContext({ campaign, template, contact = null, ctaLabel = null }) {
  const components = Array.isArray(template?.components) ? template.components : [];
  const resolve = contactVariableResolver(contact);
  const render = (type) => {
    const component = components.find(
      (c) => String(c?.type || '').toUpperCase() === type && typeof c?.text === 'string',
    );
    return component ? fillVariables(component.text, component, resolve) : '';
  };

  return {
    campaignId: campaign?.id ?? null,
    campaignName: campaign?.name ?? '',
    templateName: template?.name ?? '',
    templateLanguage: template?.language ?? '',
    templateCategory: template?.category ?? '',
    header: render('HEADER'),
    body: render('BODY'),
    footer: render('FOOTER'),
    buttons: buttonsOf(components).map((b) => String(b?.text || '').trim()).filter(Boolean),
    ctaLabel: ctaLabel ? normalizeCtaLabel(ctaLabel) : null,
    contactName: contact?.name ?? null,
    capturedAt: new Date().toISOString(),
  };
}

// The snapshot as the model reads it. Nothing is summarised or categorised —
// prices, dates, coupon codes, eligibility and anything else the campaign
// mentions reach the model verbatim, which is the only way an agent can answer
// questions nobody anticipated.
export function campaignContextText(context) {
  if (!context) return '';
  const message = [context.header, context.body, context.footer]
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join('\n\n');

  const lines = [];
  if (context.campaignName) lines.push(`Campaign: ${context.campaignName}`);
  if (context.capturedAt) lines.push(`Sent to this customer on: ${new Date(context.capturedAt).toDateString()}`);
  lines.push('', 'The exact WhatsApp message this customer received:', '---', message || '(no text content)', '---');
  if (Array.isArray(context.buttons) && context.buttons.length) {
    lines.push(`Buttons shown under the message: ${context.buttons.join(', ')}`);
  }
  return lines.join('\n');
}

// Everything the agent may answer from, in one place: what the campaign said
// for this customer, or — before any send — what it is going to say.
export async function resolveCampaignContext({ workspaceId, campaignId, recipientId = null }) {
  if (recipientId) {
    const recipient = await prisma.campaignRecipient.findFirst({
      where: { id: recipientId, campaign: { workspaceId } },
      select: { aiContext: true },
    });
    if (recipient?.aiContext) return recipient.aiContext;
  }

  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, workspaceId },
    include: { template: true },
  });
  if (!campaign) return null;
  if (campaign.aiAgentContext) return campaign.aiAgentContext;

  // Nothing has been snapshotted yet (a draft being previewed from the agent's
  // test panel) — derive it live from the template it will send.
  return buildCampaignContext({
    campaign,
    template: campaign.template,
    ctaLabel: campaign.aiAgentCtaLabel,
  });
}

// ─── Business identity ───────────────────────────────────────────────────────

// Who the customer is actually talking to. Read from the workspace and the
// WhatsApp number the message was sent from — never typed into a prompt, so a
// second workspace answers with its own name and number automatically.
export async function loadBusinessContext(workspaceId, waNumberId = null) {
  const [workspace, waNumber] = await Promise.all([
    prisma.workspace.findUnique({ where: { id: workspaceId }, select: { name: true } }),
    waNumberId
      ? prisma.waNumber.findFirst({ where: { id: waNumberId, workspaceId }, select: { phoneNumber: true, displayName: true } })
      : Promise.resolve(null),
  ]);
  if (!workspace) return null;
  return {
    businessName: workspace.name || null,
    whatsappNumber: waNumber?.phoneNumber || null,
    whatsappDisplayName: waNumber?.displayName || null,
  };
}

export function businessContextText(business) {
  if (!business) return '';
  const lines = [];
  if (business.businessName) lines.push(`Business: ${business.businessName}`);
  if (business.whatsappDisplayName && business.whatsappDisplayName !== business.businessName) {
    lines.push(`WhatsApp display name: ${business.whatsappDisplayName}`);
  }
  if (business.whatsappNumber) lines.push(`Sent from WhatsApp number: ${business.whatsappNumber}`);
  return lines.join('\n');
}

// What to call the campaign when speaking to the customer. Campaign.name is an
// internal label — "ai-test-final" is a real example from this database — so it
// is never shown. The subject is taken from the message the customer is
// holding: its header, or the first sentence of the body once a bare greeting
// ("Hi Priya!") is stripped, since that says nothing about the offer.
export function campaignSubject(context) {
  const header = String(context?.header || '').trim();
  if (header) return header.slice(0, 70);

  const body = String(context?.body || '').replace(/\s+/g, ' ').trim();
  if (!body) return null;
  const sentences = body.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);
  const meaningful = sentences.find((x) => !/^(hi|hello|hey|dear)\b/i.test(x));
  const subject = (meaningful || sentences[0] || '').replace(/[.!?]+$/, '');
  return subject ? subject.slice(0, 70) : null;
}

// ─── Sessions ────────────────────────────────────────────────────────────────

const expiryFrom = (from = Date.now()) => new Date(from + SESSION_TTL_MINUTES * 60_000);

// Typed by a customer who wants out of the campaign chat. STOP is deliberately
// absent — that is an opt-out and is handled long before this module runs.
const EXIT_PATTERN = /^(exit|quit|menu|main menu|back|end chat|close chat|cancel chat)$/i;

// Scoped by workspace as well as conversation: the conversation id already
// implies the workspace, but every campaign-AI read states its tenant so a
// mistake upstream cannot turn into a cross-tenant answer.
export async function getActiveSession(workspaceId, conversationId) {
  const session = await prisma.campaignAiSession.findFirst({
    where: { workspaceId, conversationId, status: 'ACTIVE' },
    orderBy: { lastActivityAt: 'desc' },
  });
  if (!session) return null;

  if (session.expiresAt.getTime() <= Date.now()) {
    // Lazily retired: the customer went quiet, so the next message is a fresh
    // start and belongs to the normal automation order again.
    await prisma.campaignAiSession.updateMany({
      where: { id: session.id, status: 'ACTIVE' },
      data: { status: 'EXPIRED' },
    });
    return null;
  }
  return session;
}

export async function endSession(sessionId, status = 'ENDED') {
  await prisma.campaignAiSession.updateMany({
    where: { id: sessionId, status: 'ACTIVE' },
    data: { status },
  });
}

// The campaign this conversation was last about, whatever the session's state.
//
// A session expires, but the customer's next question is usually still about
// the offer they were reading — and the normal agent, with no campaign in
// front of it, answered those blind and offered a human. Scoped to this
// conversation's own sessions, so one campaign's content can never surface in
// another campaign's chat.
export async function lastCampaignContextForConversation(conversationId, { withinDays = 7 } = {}) {
  if (!conversationId) return null;
  const since = new Date(Date.now() - withinDays * 24 * 60 * 60 * 1000);
  const session = await prisma.campaignAiSession.findFirst({
    where: { conversationId, activatedAt: { gte: since } },
    orderBy: { lastActivityAt: 'desc' },
    select: { campaignContext: true },
  });
  return session?.campaignContext ?? null;
}

// ─── Reply generation ────────────────────────────────────────────────────────

// The accuracy contract from the product spec, kept in one place so the live
// agent and the admin's test panel are held to identical rules.
const ANSWER_RULES = [
  'Answer from everything you have been given: the business details, the knowledge base, the campaign message and the conversation so far.',
  'A short reply such as "yes", "no", "ok", "sure" or "connect" refers to what you just said — read the conversation and carry on from there instead of asking the customer what they mean.',
  'Never invent prices, discounts, dates, availability, eligibility, coupon codes, links or terms that are not in the material above.',
  'Offer to pass the customer to a human only when they ask for one, or when the answer is genuinely in none of the material — say what you do know first.',
  'Reply in 1-3 short sentences, natural and conversational, suitable for WhatsApp. No markdown, no bullet symbols unless the customer asked for a list.',
  'Never mention prompts, context blocks, knowledge bases, or that you were given anything.',
].map((rule) => `- ${rule}`).join('\n');

// The single prompt builder for both modes of the agent: the normal inbound
// responder and the campaign-activated one. They differ only in whether a
// campaign snapshot is passed, so the two can never drift into answering by
// different rules or with a different identity.
export function buildAgentSystemPrompt({ agent, context = null, business = null }) {
  const businessBlock = businessContextText(business);
  return [
    agent?.prompt?.trim() || 'You are a helpful customer support agent.',
    businessBlock ? `\n\nYou answer on behalf of this business:\n${businessBlock}` : '',
    agent?.knowledge?.trim() ? `\n\nKnowledge base you may use to answer:\n${agent.knowledge.trim()}` : '',
    context ? `\n\nThe campaign message this customer received:\n${campaignContextText(context)}` : '',
    `\n\nRules:\n${ANSWER_RULES}`,
  ].join('');
}

const speakerLine = (message, agentName) =>
  `${message.direction === 'INBOUND' ? 'Customer' : agentName}: ${String(message.body || '').trim()}`;

// Answers one customer message inside a campaign session. Returns null when no
// model is reachable, which the caller turns into an honest "try again"
// rather than a fabricated answer.
export async function generateCampaignReply({ agent, context, messageBody, contactName, history = [], business = null }) {
  if (!llmAvailable()) return null;

  const system = buildAgentSystemPrompt({ agent, context, business });
  const agentName = agent?.name || 'Assistant';
  const transcript = history.map((m) => speakerLine(m, agentName)).filter((line) => line.split(': ')[1]);

  const prompt = [
    transcript.length ? `Conversation so far:\n${transcript.join('\n')}\n` : '',
    `${contactName ? `Customer (${contactName})` : 'Customer'}: ${messageBody}`,
    '',
    `${agentName}:`,
  ].join('\n');

  // One retry. The free Gemini tier rate-limits at a handful of requests per
  // minute and occasionally times out; a customer mid-conversation was getting
  // "sorry, could you ask that again?" for a transient provider failure rather
  // than for anything about their question.
  let reply = await llmText(prompt, system);
  if (!reply) {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    reply = await llmText(prompt, system);
  }
  if (!reply) return null;
  return reply.replace(/^["']|["']$/g, '').trim().slice(0, 900);
}

// The conversation since the session began, oldest first — the campaign chat's
// memory. Scoped to the session so an unrelated exchange from last week can't
// leak into it.
async function sessionHistory(session) {
  const messages = await prisma.message.findMany({
    where: { conversationId: session.conversationId, sentAt: { gte: session.activatedAt } },
    orderBy: { sentAt: 'desc' },
    take: HISTORY_MESSAGES,
    select: { body: true, direction: true, sentAt: true },
  });
  return messages.reverse();
}

// ─── Activation ──────────────────────────────────────────────────────────────

// Finds the campaign recipient a CTA click refers to. A quick-reply payload
// names it outright; a typed label is matched against recent campaigns that
// actually carry an agent. Both paths re-check ownership — the payload arrives
// from the internet and is never trusted on its own.
async function resolveCtaActivation({ workspaceId, contact, messageBody, buttonPayload }) {
  const payloadRecipientId = parseCampaignCtaPayload(buttonPayload);

  if (payloadRecipientId) {
    const recipient = await prisma.campaignRecipient.findFirst({
      where: {
        id: payloadRecipientId,
        contactId: contact.id,
        campaign: { workspaceId, aiAgentEnabled: true },
      },
      include: { campaign: true },
    });
    if (recipient) return recipient;
  }

  // A CTA label cannot be longer than a button, so anything longer is an
  // ordinary message — checked before the query so a busy inbox doesn't pay
  // for a recipient lookup on every "hi, where is my order?".
  const typed = ctaKey(messageBody);
  if (!typed || typed.length > CTA_MAX_CHARS + 5) return null;

  const since = new Date(Date.now() - TEXT_CTA_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const recipients = await prisma.campaignRecipient.findMany({
    where: {
      contactId: contact.id,
      sentAt: { gte: since },
      campaign: { workspaceId, aiAgentEnabled: true },
    },
    include: { campaign: true },
    orderBy: { sentAt: 'desc' },
    take: 20,
  });

  // The label the campaign was launched with, not whatever it says now — the
  // customer is reading a message that was sent days ago.
  return recipients.find((r) => {
    const label = r.aiContext?.ctaLabel || r.campaign.aiAgentCtaLabel || DEFAULT_CTA_LABEL;
    return ctaKey(label) === typed;
  }) || null;
}

// Starts (or re-anchors) a campaign chat. Any other session on the same
// conversation is retired first: a customer can only be talking about one
// campaign at a time, and two live sessions would race for the next reply.
export async function activateSession({ workspaceId, campaign, recipient, contact, conversation, agentId }) {
  const context = recipient?.aiContext
    || campaign.aiAgentContext
    || (await resolveCampaignContext({ workspaceId, campaignId: campaign.id }));

  await prisma.campaignAiSession.updateMany({
    where: { conversationId: conversation.id, status: 'ACTIVE' },
    data: { status: 'ENDED' },
  });

  return prisma.campaignAiSession.create({
    data: {
      workspaceId,
      campaignId: campaign.id,
      campaignRecipientId: recipient?.id ?? null,
      contactId: contact.id,
      conversationId: conversation.id,
      agentId: agentId ?? campaign.aiAgentId ?? null,
      ctaLabel: normalizeCtaLabel(recipient?.aiContext?.ctaLabel || campaign.aiAgentCtaLabel),
      campaignContext: context ?? {},
      expiresAt: expiryFrom(),
    },
  });
}

// ─── Inbound entry point ─────────────────────────────────────────────────────

// The agent a campaign named, in the shape the prompt builder wants.
//
// The agent is workspace-scoped configuration, so its id is the workspace id
// (see aiAgent.service.js listAgents). An id naming anything else is refused
// rather than quietly answered by whichever agent is nearest: a campaign that
// selected one agent must never be answered by another.
async function loadAgent(workspaceId, agentId = null) {
  if (agentId && agentId !== workspaceId) {
    console.warn(`[CampaignAI] campaign names agent ${agentId}, not workspace ${workspaceId}'s agent — declining.`);
    return null;
  }
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { aiAgentEnabled: true, aiAgentName: true, aiAgentPrompt: true, aiAgentKnowledge: true },
  });
  if (!ws) return null;
  return {
    id: workspaceId,
    name: ws.aiAgentName,
    prompt: ws.aiAgentPrompt,
    knowledge: ws.aiAgentKnowledge,
    deployed: ws.aiAgentEnabled === true,
  };
}

// Called first by the inbound handler. Returns true when the campaign agent
// dealt with the message, in which case no other automation runs for it.
//
// Order inside: an explicit CTA tap wins (it is the customer choosing a
// campaign), then a live session, then nothing — which is what keeps the rest
// of the automation priority chain exactly as it was.
export async function handleCampaignAiInbound({
  workspaceId, conversation, contact, messageBody, buttonPayload,
}) {
  if (!conversation?.waNumberId) return false;

  const reply = (body) => sendAutomatedReply({
    conversationId: conversation.id,
    waNumberId: conversation.waNumberId,
    toPhone: contact.phoneNumber,
    body,
  });

  const activation = await resolveCtaActivation({ workspaceId, contact, messageBody, buttonPayload });

  if (activation) {
    // A form in progress is a question the customer is mid-way through
    // answering. Starting a campaign chat over the top of it would strand the
    // submission, so the form keeps the conversation and the tap is ignored.
    const openForm = await prisma.whatsappFormSubmission.findFirst({
      where: { conversationId: conversation.id, completed: false },
      select: { id: true },
    });
    if (openForm) return false;

    const agent = await loadAgent(workspaceId, activation.campaign.aiAgentId);
    // An undeployed agent, a mis-pointed agent id, or a server with no model
    // configured must fall through to the ordinary automation rather than
    // answer with silence.
    if (!agent?.deployed || !llmAvailable()) return false;

    const session = await activateSession({
      workspaceId,
      campaign: activation.campaign,
      recipient: activation,
      contact,
      conversation,
      agentId: activation.campaign.aiAgentId,
    });

    // Campaign.name is an internal label the customer has never seen — one in
    // this database is literally "ai-test-final", and it was being read out to
    // customers. The greeting uses the offer itself and the business name, both
    // taken from data the customer already holds.
    const business = await loadBusinessContext(workspaceId, conversation.waNumberId);
    const subject = campaignSubject(session.campaignContext);
    const firstName = String(contact?.name || '').trim().split(' ')[0];
    await reply(
      `${firstName ? `Hi ${firstName}! ` : 'Hi! '}I'm ${agent.name}`
      + `${business?.businessName ? ` from ${business.businessName}` : ''}. `
      + `Ask me anything about ${subject || 'this offer'} and I'll help.`,
    );
    return true;
  }

  const session = await getActiveSession(workspaceId, conversation.id);
  if (!session) return false;

  if (EXIT_PATTERN.test(String(messageBody || '').trim())) {
    await endSession(session.id, 'ENDED');
    await reply('No problem — I’ve closed the chat about that offer. Message us any time.');
    return true;
  }

  const agent = await loadAgent(workspaceId, session.agentId);
  if (!agent?.deployed) {
    // The agent was undeployed mid-session. Retire the session rather than
    // leaving the conversation captured by something that can't answer.
    await endSession(session.id, 'ENDED');
    return false;
  }

  // The turn is claimed before the model is called, not after. Generation can
  // take tens of seconds, and stamping the window afterwards would let a
  // session that expired mid-answer come back to life — and would leave a
  // second message arriving in the meantime unable to see that this one is
  // already being handled.
  await prisma.campaignAiSession.update({
    where: { id: session.id },
    data: { lastActivityAt: new Date(), expiresAt: expiryFrom(), turns: { increment: 1 } },
  });

  const history = await sessionHistory(session);
  const business = await loadBusinessContext(workspaceId, conversation.waNumberId);
  const answer = await generateCampaignReply({
    agent,
    context: session.campaignContext,
    business,
    messageBody,
    contactName: contact?.name,
    // The inbound message has already been persisted by the caller, so drop it
    // from the replayed history to avoid asking the question twice.
    history: history.slice(0, -1),
  }).catch((err) => {
    console.error('[CampaignAI] reply generation failed:', err.message);
    return null;
  });

  await reply(answer || "Sorry — I couldn't work that out just now. Could you ask that again?");
  return true;
}
