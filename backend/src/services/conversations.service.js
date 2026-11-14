import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import { generateAgentReply } from './aiAgent.service.js';
import { decrypt } from '../lib/encryption.js';
import { sendTextMessage, sendWhatsAppMessage } from '../lib/meta.js';
import { getWindowState, outsideWindowError, windowStateFrom, describeWindow } from './messagingWindow.js';
import { consumeMessageCredit, releaseMessageCredit } from './subscription.service.js';
import { assertNotOptedOut, normalizePhone } from './optout.service.js';
import { countVariables, buildTextComponents, buildButtonComponents, contactVariableResolver } from '../lib/templateParams.js';
import { headerImageComponent } from './templateImage.service.js';
import { buildTemplateSendPayload } from './templatePayload.service.js';
import { NOT_DEDICATED } from '../lib/dedicatedNumber.js';

export async function listConversations(workspaceId, { page = 1, limit = 20, contactId = null, search = '' } = {}) {
  // Bounded: each row carries its contact, number and latest messages, and an
  // unbounded ?limit= let one request pull the whole inbox.
  limit = Math.min(Math.max(Math.trunc(Number(limit)) || 20, 1), 200);
  page = Math.max(Math.trunc(Number(page)) || 1, 1);
  const skip = (page - 1) * limit;
  const where = { workspaceId };
  if (contactId) {
    where.contactId = contactId;
  } else if (search && search.trim()) {
    const q = search.trim();
    const tokens = q.split(/\s+/).filter(Boolean);
    const digits = q.replace(/\D/g, '');
    const conditions = [
      { name: { contains: q, mode: 'insensitive' } },
      { phoneNumber: { contains: q } },
      { email: { contains: q, mode: 'insensitive' } },
    ];
    for (const token of tokens) {
      conditions.push({ name: { contains: token, mode: 'insensitive' } });
      conditions.push({ email: { contains: token, mode: 'insensitive' } });
    }
    if (digits.length >= 3) {
      conditions.push({ phoneNumber: { contains: digits } });
    }
    where.contact = {
      OR: conditions,
    };
  }

  const [data, total] = await Promise.all([
    prisma.conversation.findMany({
      where,
      skip,
      take: limit,
      orderBy: { lastMessageAt: 'desc' },
      include: {
        contact: { select: { id: true, name: true, phoneNumber: true, email: true, optedOut: true } },
        waNumber: { select: { id: true, phoneNumber: true, displayName: true, status: true } },
        // Two messages rather than one: the preview needs the latest, and
        // "who is handling this" needs the latest *outbound*, which is often
        // the one behind it.
        messages: {
          orderBy: { sentAt: 'desc' },
          take: 2,
          select: { id: true, body: true, direction: true, sentAt: true, senderUserId: true },
        },
        assignedTo: { select: { id: true, name: true } },
        // Present only while a campaign chat window is open — which is exactly
        // what "AI-handled" means in the inbox filter.
        aiSessions: {
          where: { status: 'ACTIVE' },
          select: { id: true, campaignId: true, turns: true },
          take: 1,
        },
      },
    }),
    prisma.conversation.count({ where }),
  ]);
  return { data, total };
}

export async function getOrCreateConversation(workspaceId, { contactId, waNumberId = null } = {}) {
  if (!contactId) {
    const e = new Error('contactId is required');
    e.status = 400;
    throw e;
  }

  const contact = await prisma.contact.findFirst({
    where: { id: contactId, workspaceId },
  });
  if (!contact) {
    const e = new Error('Contact not found');
    e.status = 404;
    throw e;
  }

  let conversation = await prisma.conversation.findFirst({
    where: { workspaceId, contactId },
    include: {
      contact: true,
      waNumber: true,
    },
    orderBy: { lastMessageAt: 'desc' },
  });

  // A number dedicated to a context agent is never chosen for a conversation
  // the team starts: the agent only ever answers customers who wrote to it
  // first. A thread that already exists on such a number is still returned
  // above, so the inbox can open it.
  let resolvedWaNumberId = waNumberId;
  if (resolvedWaNumberId) {
    const valid = await prisma.waNumber.findFirst({ where: { id: resolvedWaNumberId, workspaceId, ...NOT_DEDICATED } });
    if (!valid) resolvedWaNumberId = null;
  }
  if (!resolvedWaNumberId) {
    const defaultNumber = await prisma.waNumber.findFirst({
      where: { workspaceId, status: { in: ['ACTIVE', 'CONNECTED'] }, ...NOT_DEDICATED },
    }) || await prisma.waNumber.findFirst({ where: { workspaceId, ...NOT_DEDICATED } });
    resolvedWaNumberId = defaultNumber?.id || null;
  }

  if (conversation) {
    if (!conversation.waNumberId && resolvedWaNumberId) {
      conversation = await prisma.conversation.update({
        where: { id: conversation.id },
        data: { waNumberId: resolvedWaNumberId },
        include: {
          contact: true,
          waNumber: true,
        },
      });
    }
    return conversation;
  }

  conversation = await prisma.conversation.create({
    data: {
      workspaceId,
      contactId,
      status: 'OPEN',
      waNumberId: resolvedWaNumberId,
    },
    include: {
      contact: true,
      waNumber: true,
    },
  });

  return conversation;
}

export async function getMessages(workspaceId, conversationId) {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, workspaceId },
  });
  if (!conversation) { const e = new Error('Conversation not found'); e.status = 404; throw e; }

  await prisma.conversation.update({ where: { id: conversationId }, data: { unreadCount: 0 } });

  const messages = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { sentAt: 'asc' },
    include: { senderUser: { select: { id: true, name: true } } },
  });

  // The composer needs to know whether a free-form reply is even allowed before
  // the agent types one. Returned alongside the thread so the inbox can say
  // "the window closed, send a template" rather than letting the send fail.
  const window = windowStateFrom(conversation.lastInboundAt);

  return {
    messages,
    // Whether the automation is currently allowed to answer this thread, so the
    // composer can show it rather than leaving the agent guessing whether the
    // bot is about to reply over them.
    botEnabled: conversation.humanHandoffAt === null,
    humanHandoffAt: conversation.humanHandoffAt,
    window: {
      open: window.open,
      lastInboundAt: window.lastInboundAt,
      expiresAt: window.expiresAt,
      msRemaining: window.msRemaining,
      description: describeWindow(window),
    },
  };
}

// Meta's rejections reach the agent verbatim otherwise — "Request failed with
// status code 400" says nothing about what to do next. The codes translated
// here are the ones with an actual remedy.
function describeSendFailure(err) {
  const meta = err.response?.data?.error;
  if (!meta) {
    const e = new Error(`Could not reach WhatsApp: ${err.message}`);
    e.status = 502; e.expose = true; return e;
  }
  const raw = `${meta.message}${meta.error_data?.details ? ` — ${meta.error_data.details}` : ''} (code ${meta.code})`;
  const map = {
    131047: 'The 24-hour reply window has closed — send an approved template to reopen the conversation.',
    131026: 'That number is not a valid WhatsApp account.',
    190:    'The WhatsApp access token has expired — reconnect the number in Number Setup.',
    100:    'WhatsApp no longer recognises this number. Reconnect it in Number Setup.',
    131042: 'WhatsApp refused the send for a billing or rate limit reason on the business account.',
  };
  const e = new Error(map[Number(meta.code)] ? `${map[Number(meta.code)]} (${raw})` : raw);
  e.status = Number(meta.code) === 131047 ? 409 : 502;
  e.code = Number(meta.code) === 131047 ? 'OUTSIDE_24H_WINDOW' : 'WHATSAPP_SEND_FAILED';
  e.expose = true;
  return e;
}

// WhatsApp caps a text message body at 4096 characters.
const MAX_TEXT_LENGTH = 4096;

// Contact.optedOut is set directly from the Contacts screen as well as by the
// OptOut list, and campaigns already honour both (partitionByOptOut). The inbox
// only checked the list, so a contact flagged on their record could still be
// messaged one-to-one.
async function assertContactReachable(workspaceId, contact) {
  if (contact?.optedOut === true) {
    const e = new Error('Recipient opted out');
    e.status = 403; e.code = 'RECIPIENT_OPTED_OUT'; e.expose = true;
    throw e;
  }
  await assertNotOptedOut(workspaceId, contact?.phoneNumber);
}

export async function sendMessage(workspaceId, conversationId, userId, { type, body, contactId, phoneNumber } = {}) {
  const text = typeof body === 'string' ? body.trim() : '';
  if (!text) { const e = new Error('Type a message before sending'); e.status = 400; e.expose = true; throw e; }
  if (text.length > MAX_TEXT_LENGTH) {
    const e = new Error(`WhatsApp messages are limited to ${MAX_TEXT_LENGTH} characters (this one is ${text.length}).`);
    e.status = 400; e.expose = true; throw e;
  }

  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, workspaceId },
    include: { contact: true, waNumber: true },
  });
  if (!conversation) { const e = new Error('Conversation not found'); e.status = 404; throw e; }

  if (contactId && conversation.contactId !== contactId) {
    const e = new Error('Recipient mismatch: conversation contact does not match the target contact');
    e.status = 400; e.code = 'RECIPIENT_MISMATCH'; e.expose = true; throw e;
  }
  if (phoneNumber && normalizePhone(conversation.contact.phoneNumber) !== normalizePhone(phoneNumber)) {
    const e = new Error('Recipient mismatch: conversation phone number does not match the target contact');
    e.status = 400; e.code = 'RECIPIENT_MISMATCH'; e.expose = true; throw e;
  }

  // The thread survives its number being disconnected, but there is nothing left
  // to send from — the history stays readable, replies do not.
  if (!conversation.waNumber) {
    const e = new Error('The WhatsApp number for this conversation was disconnected — connect a number to reply.');
    e.status = 409;
    throw e;
  }

  // Opt-out is checked on every outbound path, including a human replying
  // from the inbox — a customer who sent STOP must not be messaged again.
  await assertContactReachable(workspaceId, conversation.contact);

  // WhatsApp's 24-hour rule, enforced before anything is charged or sent.
  //
  // This used to attempt the send regardless and, when Meta's API answered 200,
  // stamp lastInboundAt = now. But the Cloud API accepts the request and reports
  // an out-of-window send later, as a `failed` status webhook (131047) — so the
  // 200 proved nothing, and writing an *inbound* timestamp for an *outbound*
  // message fabricated a fresh window that every automated reply then trusted.
  // lastInboundAt is only ever written by a real inbound message.
  const windowState = await getWindowState(conversationId);
  if (!windowState.open) throw outsideWindowError(windowState);

  const credit = await consumeMessageCredit(workspaceId, { reason: 'Message overage' });
  if (!credit.ok) {
    const e = new Error('Message quota and wallet balance exhausted — recharge your wallet or upgrade your plan');
    e.status = 403;
    throw e;
  }

  const accessToken = decrypt(conversation.waNumber.encryptedAccessToken);
  let result;
  try {
    result = await sendTextMessage(
      conversation.waNumber.metaPhoneNumberId,
      accessToken,
      conversation.contact.phoneNumber,
      text
    );
  } catch (err) {
    // The credit was consumed before the send. Nothing went out, so hand it
    // back rather than charging for a message that does not exist.
    await releaseMessageCredit(workspaceId, { source: credit.source, amount: credit.amount ?? null }).catch(() => {});
    throw describeSendFailure(err);
  }

  const message = await prisma.message.create({
    data: {
      conversationId,
      body: text,
      direction: 'OUTBOUND',
      type: 'TEXT',
      metaMessageId: result?.messages?.[0]?.id,
      // Accepted by Meta; the status webhook moves it on to DELIVERED/READ.
      status: 'SENT',
      statusAt: new Date(),
      senderUserId: userId,
    },
    include: { senderUser: { select: { id: true, name: true } } },
  });

  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      lastMessageAt: new Date(),
      // A person replying is a takeover. Shared inboxes work this way for a
      // reason: once an agent is in the thread, an automated reply arriving
      // between their messages reads as the company talking to itself.
      // Resolving the thread, or the Bot toggle, hands it back.
      ...(userId ? { humanHandoffAt: new Date() } : {}),
    },
  });

  return message;
}


// Sends a file on an open conversation.
//
// The composer was text-only and no route accepted an attachment, so an agent
// could receive a customer's photo or PDF and had no way to reply with one.
// Everything the text path enforces applies here too — opt-out, the 24-hour
// window, and a message credit that is handed back if Meta rejects the send.
export async function sendMediaMessage(workspaceId, conversationId, userId, { buffer, mimeType, fileName, caption } = {}) {
  const { OUTBOUND_MEDIA_TYPES, uploadPhoneMedia, sendMediaMessage: sendViaMeta } = await import('../lib/meta.js');

  const spec = OUTBOUND_MEDIA_TYPES[mimeType];
  if (!spec) {
    const e = new Error(`WhatsApp does not accept ${mimeType} as an attachment. Send a JPG, PNG, MP4, PDF or audio file.`);
    e.status = 400; e.expose = true; throw e;
  }
  if (!buffer?.length) { const e = new Error('That file is empty'); e.status = 400; throw e; }
  if (buffer.length > spec.maxBytes) {
    const e = new Error(
      `That file is ${(buffer.length / 1024 / 1024).toFixed(1)} MB — WhatsApp's limit for a ${spec.type} is `
      + `${spec.maxBytes / 1024 / 1024} MB.`,
    );
    e.status = 400; e.expose = true; throw e;
  }

  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, workspaceId },
    include: { contact: true, waNumber: true },
  });
  if (!conversation) { const e = new Error('Conversation not found'); e.status = 404; throw e; }
  if (!conversation.waNumber) {
    const e = new Error('The WhatsApp number for this conversation was disconnected — connect a number to reply.');
    e.status = 409; throw e;
  }

  await assertContactReachable(workspaceId, conversation.contact);

  // An attachment is a free-form message, so the same 24-hour rule applies.
  const windowState = await getWindowState(conversationId);
  if (!windowState.open) throw outsideWindowError(windowState);

  const credit = await consumeMessageCredit(workspaceId, { reason: 'Media message' });
  if (!credit.ok) {
    const e = new Error('Message quota and wallet balance exhausted — recharge your wallet or upgrade your plan');
    e.status = 403;
    throw e;
  }

  const accessToken = decrypt(conversation.waNumber.encryptedAccessToken);
  let result;
  let mediaId;
  try {
    // Two steps against Meta: upload the bytes to the phone number, then send
    // the id. The id is scoped to that number and expires in about 30 days.
    mediaId = await uploadPhoneMedia({
      phoneNumberId: conversation.waNumber.metaPhoneNumberId,
      accessToken, buffer, mimeType, fileName,
    });
    result = await sendViaMeta(
      conversation.waNumber.metaPhoneNumberId, accessToken, conversation.contact.phoneNumber,
      { mediaId, type: spec.type, caption, filename: fileName },
    );
  } catch (err) {
    await releaseMessageCredit(workspaceId, { source: credit.source, amount: credit.amount ?? null }).catch(() => {});
    throw describeSendFailure(err);
  }

  const message = await prisma.message.create({
    data: {
      conversationId,
      // The caption is the agent's words; without one the type stands in, the
      // same way inbound media is rendered.
      body: caption?.trim() || `[${spec.type}]`,
      direction: 'OUTBOUND',
      type: spec.type.toUpperCase(),
      metaMessageId: result?.messages?.[0]?.id,
      status: 'SENT',
      statusAt: new Date(),
      senderUserId: userId,
      mediaId,
      mediaMimeType: mimeType,
      mediaFilename: fileName || null,
    },
    include: { senderUser: { select: { id: true, name: true } } },
  });

  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      lastMessageAt: new Date(),
      ...(userId ? { humanHandoffAt: new Date() } : {}),
    },
  });

  return message;
}

// The {{n}} positions (1-based) with no value. {{1}} is never reported: it
// falls back to the contact's name, or "there" (see sendTemplateMessage).
export function missingTemplateVariables(required, supplied) {
  const missing = [];
  for (let i = 1; i < required; i += 1) if (!String(supplied?.[i] ?? '').trim()) missing.push(i + 1);
  return missing;
}

// Sends an approved template on a conversation, which is the only thing
// WhatsApp permits once the 24-hour window has closed.
//
// The app enforced the window and then offered no way through it: every error
// message told the agent to "send an approved template to reopen the
// conversation" while no route existed to send one. Closing the window without
// this is only half the rule.
export async function sendTemplateMessage(workspaceId, conversationId, userId, { templateId, variables = [], contactId, phoneNumber } = {}) {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, workspaceId },
    include: { contact: true, waNumber: true },
  });
  if (!conversation) { const e = new Error('Conversation not found'); e.status = 404; throw e; }

  if (contactId && conversation.contactId !== contactId) {
    const e = new Error('Recipient mismatch: conversation contact does not match the target contact');
    e.status = 400; e.code = 'RECIPIENT_MISMATCH'; e.expose = true; throw e;
  }
  if (phoneNumber && normalizePhone(conversation.contact.phoneNumber) !== normalizePhone(phoneNumber)) {
    const e = new Error('Recipient mismatch: conversation phone number does not match the target contact');
    e.status = 400; e.code = 'RECIPIENT_MISMATCH'; e.expose = true; throw e;
  }
  if (!conversation.waNumber) {
    const e = new Error('The WhatsApp number for this conversation was disconnected — connect a number to reply.');
    e.status = 409; throw e;
  }

  // Opt-out still applies. A template is not an exemption from someone asking
  // to be left alone — it is only an exemption from the timing rule.
  await assertContactReachable(workspaceId, conversation.contact);

  const template = await prisma.template.findFirst({
    where: { id: templateId, workspaceId },
  });
  if (!template) { const e = new Error('Template not found'); e.status = 404; throw e; }
  if (template.status !== 'APPROVED') {
    const e = new Error(
      `"${template.name}" is ${String(template.status).toLowerCase()} and cannot be sent. `
      + 'Only templates Meta has approved may be used.',
    );
    e.status = 422; e.code = 'TEMPLATE_NOT_SENDABLE'; e.expose = true; throw e;
  }

  // Variables are settled before anything is charged. A missing {{2}} and up
  // used to be filled from the contact's name, the approved sample, or the
  // literal word "there" — so "Your order {{2}} ships {{3}}" went out as
  // "Your order there ships there", or quoted the sample customer's price.
  // Only {{1}} keeps a fallback: it is the greeting-name slot by convention
  // (lib/templateParams.js contactVariableResolver), and "Hi Priya" / "Hi
  // there" is the documented behaviour for it.
  const components = Array.isArray(template.components) ? template.components : [];
  const required = components.reduce((max, c) => Math.max(max, countVariables(c?.text)), 0);
  const supplied = (Array.isArray(variables) ? variables : []).map((v) => String(v ?? '').trim());
  const missing = missingTemplateVariables(required, supplied);
  if (missing.length) {
    const e = new Error(
      `"${template.name}" needs a value for ${missing.map((n) => `{{${n}}}`).join(', ')} — nothing was sent.`,
    );
    e.status = 422; e.code = 'TEMPLATE_VARIABLES_REQUIRED'; e.expose = true;
    e.details = { requiredVariables: required, missingVariables: missing };
    throw e;
  }
  // A contact created from a bare number (an API send, an inbound message with
  // no profile name) is "named" its phone number — "Hi +919876543210" is worse
  // than the documented "Hi there".
  const contactName = String(conversation.contact?.name || '');
  const nameIsPhone = !/[\p{L}]/u.test(contactName) && normalizePhone(contactName) === normalizePhone(conversation.contact?.phoneNumber);
  const nameResolver = contactVariableResolver(nameIsPhone ? { ...conversation.contact, name: '' } : conversation.contact);
  const resolve = (i, component) => supplied[i] || (i === 0 ? nameResolver(0, component) : '');

  const credit = await consumeMessageCredit(workspaceId, {
    reason: 'Template message',
    messageCategory: template.category ?? null,
  });
  if (!credit.ok) {
    const e = new Error('Message quota and wallet balance exhausted — recharge your wallet or upgrade your plan');
    e.status = 403;
    throw e;
  }

  let result;
  try {
    const accessToken = decrypt(conversation.waNumber.encryptedAccessToken);
    // Inside the try: building the payload can fail (a header image Meta will
    // not take), and the credit is already spent by then.
    const payload = await buildTemplateSendPayload(template, {
      phoneNumberId: conversation.waNumber.metaPhoneNumberId,
      accessToken,
      resolve,
    });
    result = await sendWhatsAppMessage(
      conversation.waNumber.metaPhoneNumberId, accessToken,
      conversation.contact.phoneNumber, payload,
    );
  } catch (err) {
    await releaseMessageCredit(workspaceId, { source: credit.source, amount: credit.amount ?? null }).catch(() => {});
    throw describeSendFailure(err);
  }

  const message = await prisma.message.create({
    data: {
      conversationId,
      body: `[Template: ${template.name}]`,
      direction: 'OUTBOUND',
      type: 'TEMPLATE',
      metaMessageId: result?.messages?.[0]?.id,
      status: 'SENT',
      statusAt: new Date(),
      senderUserId: userId,
    },
    include: { senderUser: { select: { id: true, name: true } } },
  });

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { lastMessageAt: new Date() },
  });

  // Deliberately does NOT touch lastInboundAt. A template does not reopen the
  // free-form window — only the customer replying does. Setting it here would
  // let an agent send one template and then chat freely, which is exactly the
  // rule WhatsApp is enforcing.
  return message;
}

// ─── Conversation context ────────────────────────────────────────────────────
//
// Everything the inbox's right-hand panel shows about a thread that is not the
// thread itself: which campaign started it, what the AI did before a human
// arrived, and what has happened to this customer over time.
//
// It is one endpoint rather than four because the panel opens as a unit, and
// four round trips to fill one sidebar is four chances to render half of it.
export async function getContext(workspaceId, conversationId) {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, workspaceId },
    select: {
      id: true, status: true, label: true, assignedToUserId: true, createdAt: true, lastMessageAt: true,
      contact: { select: { id: true, name: true, phoneNumber: true, tags: true, createdAt: true, optedOut: true } },
      assignedTo: { select: { id: true, name: true, email: true } },
    },
  });
  if (!conversation) { const e = new Error('Conversation not found'); e.status = 404; throw e; }

  const contactId = conversation.contact.id;

  const [aiSession, recipient, firstInbound, firstHumanReply, messageCounts] = await Promise.all([
    prisma.campaignAiSession.findFirst({
      where: { conversationId },
      orderBy: { activatedAt: 'desc' },
      select: {
        id: true, status: true, turns: true, ctaLabel: true,
        activatedAt: true, lastActivityAt: true, expiresAt: true,
        campaign: { select: { id: true, name: true, status: true } },
      },
    }),
    // The most recent campaign this contact was actually sent, whether or not
    // it opened an AI chat. A thread can start from a campaign the customer
    // simply replied to.
    prisma.campaignRecipient.findFirst({
      where: { contactId, campaign: { workspaceId } },
      orderBy: { sentAt: 'desc' },
      select: {
        sentAt: true, deliveredAt: true, readAt: true, status: true,
        campaign: { select: { id: true, name: true } },
      },
    }),
    prisma.message.findFirst({
      where: { conversationId, direction: 'INBOUND' },
      orderBy: { sentAt: 'asc' },
      select: { sentAt: true, body: true },
    }),
    prisma.message.findFirst({
      where: { conversationId, direction: 'OUTBOUND', senderUserId: { not: null } },
      orderBy: { sentAt: 'asc' },
      select: { sentAt: true, senderUser: { select: { name: true } } },
    }),
    prisma.message.groupBy({
      by: ['direction'],
      where: { conversationId },
      _count: { _all: true },
    }),
  ]);

  const counts = Object.fromEntries(messageCounts.map((m) => [m.direction, m._count._all]));

  // Outbound messages with no sender are the agent's. That distinction is the
  // only place "handled by AI" is recorded, so it is also how the timeline
  // knows a human took over.
  const botReplies = await prisma.message.count({
    where: { conversationId, direction: 'OUTBOUND', senderUserId: null },
  });

  // Built as a list of real, timestamped events, then sorted. Nothing is
  // inferred that did not happen: an entry exists only because a row does.
  const timeline = [];
  const push = (at, text, kind) => { if (at) timeline.push({ at, text, kind }); };

  push(conversation.contact.createdAt, 'Added as a contact', 'contact');
  if (recipient?.campaign) {
    push(recipient.sentAt, `Sent “${recipient.campaign.name}”`, 'campaign');
    push(recipient.deliveredAt, 'Campaign delivered', 'campaign');
    push(recipient.readAt, 'Campaign read', 'campaign');
  }
  if (aiSession) {
    push(aiSession.activatedAt, `Opened a chat from ${aiSession.campaign?.name || 'a campaign'}`, 'ai');
  }
  push(firstInbound?.sentAt, 'First message from the customer', 'inbound');
  if (firstHumanReply) {
    push(firstHumanReply.sentAt, `${firstHumanReply.senderUser?.name || 'A teammate'} took over`, 'human');
  }
  if (conversation.status !== 'OPEN') {
    push(conversation.lastMessageAt, `Marked ${conversation.status.toLowerCase()}`, 'status');
  }
  timeline.sort((a, b) => new Date(a.at) - new Date(b.at));

  return {
    conversation: {
      id: conversation.id,
      status: conversation.status,
      label: conversation.label,
      assignedTo: conversation.assignedTo,
    },
    contact: conversation.contact,
    campaignSource: recipient?.campaign
      ? {
          id: recipient.campaign.id,
          name: recipient.campaign.name,
          sentAt: recipient.sentAt,
          deliveredAt: recipient.deliveredAt,
          readAt: recipient.readAt,
          status: recipient.status,
        }
      : null,
    aiSession: aiSession
      ? {
          status: aiSession.status,
          turns: aiSession.turns,
          ctaLabel: aiSession.ctaLabel,
          campaign: aiSession.campaign,
          activatedAt: aiSession.activatedAt,
          expiresAt: aiSession.expiresAt,
          handedOver: !!firstHumanReply,
        }
      : null,
    messages: {
      inbound: counts.INBOUND || 0,
      outbound: counts.OUTBOUND || 0,
      byAgent: botReplies,
      byTeam: (counts.OUTBOUND || 0) - botReplies,
    },
    timeline,
  };
}

// A drafted reply for the composer's suggestion chips.
//
// It runs the same agent the customer would have got, against the same
// conversation history — so accepting a suggestion sends what the AI would have
// sent, and editing one is a real edit rather than a rewrite of something else.
export async function suggestReply(workspaceId, conversationId) {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, workspaceId },
    select: { id: true, waNumberId: true, contact: { select: { name: true } } },
  });
  if (!conversation) { const e = new Error('Conversation not found'); e.status = 404; throw e; }

  const lastInbound = await prisma.message.findFirst({
    where: { conversationId, direction: 'INBOUND' },
    orderBy: { sentAt: 'desc' },
    select: { body: true },
  });
  if (!lastInbound?.body) return { suggestions: [], reason: 'Nothing from the customer to answer yet.' };

  const reply = await generateAgentReply(workspaceId, lastInbound.body, {
    contactName: conversation.contact?.name,
    conversationId,
    waNumberId: conversation.waNumberId,
  });

  if (!reply) {
    return {
      suggestions: [],
      reason: 'The AI agent is not deployed, or no model is configured on the server.',
    };
  }
  return { suggestions: [reply], answering: lastInbound.body };
}

// ─── Internal notes ──────────────────────────────────────────────────────────
//
// Private to the team. Nothing here ever reaches WhatsApp — see the model
// comment on ConversationNote for why these are not Messages.

export async function listNotes(workspaceId, conversationId) {
  const conversation = await prisma.conversation.findFirst({ where: { id: conversationId, workspaceId }, select: { id: true } });
  if (!conversation) { const e = new Error('Conversation not found'); e.status = 404; throw e; }
  return prisma.conversationNote.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'desc' },
    include: { author: { select: { id: true, name: true } } },
  });
}

export async function addNote(workspaceId, conversationId, authorId, body) {
  const text = String(body || '').trim();
  if (!text) { const e = new Error('Write something before saving the note'); e.status = 400; throw e; }
  const conversation = await prisma.conversation.findFirst({ where: { id: conversationId, workspaceId }, select: { id: true } });
  if (!conversation) { const e = new Error('Conversation not found'); e.status = 404; throw e; }
  return prisma.conversationNote.create({
    data: { conversationId, authorId: authorId || null, body: text.slice(0, 4000) },
    include: { author: { select: { id: true, name: true } } },
  });
}

export async function deleteNote(workspaceId, conversationId, noteId) {
  const note = await prisma.conversationNote.findFirst({
    where: { id: noteId, conversation: { id: conversationId, workspaceId } },
    select: { id: true },
  });
  if (!note) { const e = new Error('Note not found'); e.status = 404; throw e; }
  await prisma.conversationNote.delete({ where: { id: noteId } });
  return { ok: true };
}

// Assign a thread to a teammate, or hand it back to the agent by passing null.
export async function assignConversation(workspaceId, conversationId, assignedToUserId) {
  const conversation = await prisma.conversation.findFirst({ where: { id: conversationId, workspaceId }, select: { id: true } });
  if (!conversation) { const e = new Error('Conversation not found'); e.status = 404; throw e; }
  // Only to someone in this workspace. Any user id was accepted, and the
  // response echoed that user's name back — a way to assign a thread to (and
  // look up) people in other tenants.
  if (assignedToUserId) {
    const member = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId: String(assignedToUserId), workspaceId } },
      select: { userId: true },
    });
    if (!member) { const e = new Error('That person is not a member of this workspace'); e.status = 400; throw e; }
  }
  return prisma.conversation.update({
    where: { id: conversationId },
    data: { assignedToUserId: assignedToUserId || null },
    include: { assignedTo: { select: { id: true, name: true } } },
  });
}

// OPEN | PENDING | RESOLVED | CLOSED, as the schema's ConversationStatus enum
// defines them. Validated here rather than trusting the body, because an
// invalid value would fail at the database with a message nobody can act on.
const CONVERSATION_STATUSES = new Set(['OPEN', 'PENDING', 'RESOLVED', 'CLOSED']);

export async function setConversationStatus(workspaceId, conversationId, status) {
  const next = String(status || '').toUpperCase();
  if (!CONVERSATION_STATUSES.has(next)) {
    const e = new Error(`Unknown conversation status "${status}"`); e.status = 400; throw e;
  }
  const conversation = await prisma.conversation.findFirst({ where: { id: conversationId, workspaceId }, select: { id: true } });
  if (!conversation) { const e = new Error('Conversation not found'); e.status = 404; throw e; }
  return prisma.conversation.update({
    where: { id: conversationId },
    data: {
      status: next,
      // Resolving ends the human's ownership: a customer who writes again
      // starts a fresh exchange, and the automation should answer it.
      ...(next === 'RESOLVED' ? { humanHandoffAt: null } : {}),
    },
  });
}

// Hands a conversation back to the automation, or takes it away from it.
//
// Handing off is easy to trigger and hard to undo without this: the bot stays
// out of a thread until someone resolves it, which is not always what an agent
// wants after answering one question.
export async function setBotEnabled(workspaceId, conversationId, enabled) {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, workspaceId }, select: { id: true },
  });
  if (!conversation) { const e = new Error('Conversation not found'); e.status = 404; throw e; }

  const updated = await prisma.conversation.update({
    where: { id: conversationId },
    data: { humanHandoffAt: enabled ? null : new Date() },
  });
  return {
    botEnabled: updated.humanHandoffAt === null,
    humanHandoffAt: updated.humanHandoffAt,
  };
}

/**
 * Explicitly reopen/sync the 24-hour reply window for a conversation.
 * Useful when the contact messaged outside webhooks or during manual sync.
 */
// Both of these write a customer-inbound timestamp that no customer sent. On a
// live workspace that is a way round WhatsApp's 24-hour rule for any member
// (agents included): "reopen" the window, then free-form message someone who
// has not written in weeks — which Meta rejects anyway, after the credit and
// the automation have already acted on the fake window. They exist for local
// testing without a real webhook, so that is the only place they answer.
function assertDevOnly() {
  if (env.NODE_ENV === 'production') {
    const e = new Error('Not found');
    e.status = 404;
    throw e;
  }
}

export async function reopenWindow(workspaceId, conversationId) {
  assertDevOnly();
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, workspaceId },
  });
  if (!conversation) {
    const e = new Error('Conversation not found');
    e.status = 404;
    throw e;
  }
  const now = new Date();
  const updated = await prisma.conversation.update({
    where: { id: conversationId },
    data: { lastInboundAt: now },
  });
  return { success: true, lastInboundAt: updated.lastInboundAt, window: windowStateFrom(now) };
}

/**
 * Simulate an inbound WhatsApp message from the contact for testing/dev environments.
 * Supports simulating audio voice notes with automatic speech-to-text.
 */
const SIMULATABLE_TYPES = new Set(['TEXT', 'AUDIO']);

export async function simulateInboundMessage(workspaceId, conversationId, { body = 'Hii', type = 'TEXT', buffer, mimeType } = {}) {
  assertDevOnly();
  if (!SIMULATABLE_TYPES.has(type)) {
    const e = new Error('Only TEXT or AUDIO messages can be simulated'); e.status = 400; throw e;
  }
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, workspaceId },
    include: { contact: true, waNumber: true },
  });
  if (!conversation) {
    const e = new Error('Conversation not found');
    e.status = 404;
    throw e;
  }
  const now = new Date();
  let resolvedBody = String(body || 'Hii').trim();
  const isAudio = type === 'AUDIO';

  if (isAudio && buffer) {
    const { transcribeAudioBuffer } = await import('./stt.service.js');
    const stt = await transcribeAudioBuffer(buffer, mimeType || 'audio/ogg').catch(() => null);
    if (stt) resolvedBody = stt;
  }

  const message = await prisma.message.create({
    data: {
      conversationId,
      body: resolvedBody,
      direction: 'INBOUND',
      type: isAudio ? 'AUDIO' : 'TEXT',
      status: 'DELIVERED',
      statusAt: now,
      sentAt: now,
      // Never a caller-supplied id: the media proxy resolves mediaId against
      // the Graph API with the number's token.
      mediaId: null,
      mediaMimeType: isAudio ? (mimeType || 'audio/ogg') : null,
    },
  });
  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      lastInboundAt: now,
      lastMessageAt: now,
      unreadCount: { increment: 1 },
    },
  });
  return { success: true, message, window: windowStateFrom(now) };
}

/**
 * Streams / downloads binary media for an existing conversation message.
 */
export async function getMessageMediaStream(workspaceId, conversationId, messageId) {
  // Scoped through the conversation to the caller's workspace. Without the
  // workspace filter, any signed-in user could name another tenant's
  // conversation and message ids in their own workspace's URL and download
  // that tenant's customer media — fetched with the other tenant's token.
  const message = await prisma.message.findFirst({
    where: { id: messageId, conversationId, conversation: { workspaceId } },
    include: {
      conversation: {
        include: { waNumber: true },
      },
    },
  });
  if (!message) {
    const e = new Error('Message not found');
    e.status = 404;
    throw e;
  }
  if (!message.mediaId) {
    const e = new Error('Message has no media attachment');
    e.status = 404;
    throw e;
  }

  const { downloadMediaBuffer } = await import('../lib/meta.js');
  const accessToken = message.conversation?.waNumber?.encryptedAccessToken
    ? decrypt(message.conversation.waNumber.encryptedAccessToken)
    : null;

  return downloadMediaBuffer(message.mediaId, accessToken);
}

