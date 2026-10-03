import { prisma } from '../lib/prisma.js';
import { listWindow } from '../lib/paging.js';
import { markFirstResponseForConversation } from './tickets.service.js';
import { generateAgentReply } from './aiAgent.service.js';
import { decrypt } from '../lib/encryption.js';
import { sendTextMessage, sendWhatsAppMessage } from '../lib/meta.js';
import { getWindowState, outsideWindowError, windowStateFrom, describeWindow } from './messagingWindow.js';
import { consumeMessageCredit, releaseMessageCredit } from './subscription.service.js';
import { assertNotOptedOut, normalizePhone } from './optout.service.js';
import { countVariables, buildTextComponents, buildButtonComponents, contactVariableResolver } from '../lib/templateParams.js';
import { headerImageComponent } from './templateImage.service.js';
import { buildTemplateSendPayload } from './templatePayload.service.js';
import { assertWorkspaceMember } from './crmReferences.js';
import { realtime } from '../lib/realtimeBus.js';
import { archiveOutboundMedia } from './inboundMedia.service.js';

// Keyset cursor over (lastMessageAt desc, id desc), opaque to the client. A
// page/skip offset shifts under the inbox's feet as new messages reorder it.
const encodeCursor = (c) => Buffer.from(`${new Date(c.lastMessageAt).toISOString()}|${c.id}`).toString('base64url');
function decodeCursor(cursor) {
  try {
    const [at, id] = Buffer.from(String(cursor), 'base64url').toString().split('|');
    const lastMessageAt = new Date(at);
    if (!id || Number.isNaN(lastMessageAt.getTime())) return null;
    return { lastMessageAt, id };
  } catch {
    return null;
  }
}

// The inbox's views, applied in the query so they cover every conversation
// rather than only the page already loaded.
//   unassigned — nobody has the thread
//   mine       — assigned to the caller
//   ai         — a campaign AI session is live, or the automation has replied
//                and no person has taken the thread over
function viewFilter(view, userId) {
  switch (view) {
    case 'unassigned': return { assignedToUserId: null };
    case 'mine': return { assignedToUserId: userId || '__nobody__' };
    case 'ai': return {
      OR: [
        { aiSessions: { some: { status: 'ACTIVE' } } },
        { humanHandoffAt: null, assignedToUserId: null, messages: { some: { direction: 'OUTBOUND', senderUserId: null } } },
      ],
    };
    default: return null;
  }
}

export async function listConversations(workspaceId, {
  page = 1, limit = 20, contactId = null, search = '', cursor = null, view = null, userId = null,
} = {}) {
  limit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const after = cursor ? decodeCursor(cursor) : null;
  const skip = after ? 0 : (Math.max(Number(page) || 1, 1) - 1) * limit;
  const where = { workspaceId };
  const and = [];
  const viewWhere = viewFilter(view, userId);
  if (viewWhere) and.push(viewWhere);
  if (after) {
    and.push({
      OR: [
        { lastMessageAt: { lt: after.lastMessageAt } },
        { lastMessageAt: after.lastMessageAt, id: { lt: after.id } },
      ],
    });
  }
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
  // The cursor bound is left out of the count so `total` describes the view.
  const countWhere = viewWhere ? { ...where, AND: [viewWhere] } : where;
  if (and.length) where.AND = and;

  const [rows, total] = await Promise.all([
    prisma.conversation.findMany({
      where,
      skip,
      take: limit + 1,
      orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
      include: {
        contact: { select: { id: true, name: true, phoneNumber: true, email: true, optedOut: true, instagramUsername: true } },
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
    prisma.conversation.count({ where: countWhere }),
  ]);
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  return { data, total, nextCursor: hasMore ? encodeCursor(data[data.length - 1]) : null };
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

  let resolvedWaNumberId = waNumberId;
  if (resolvedWaNumberId) {
    const valid = await prisma.waNumber.findFirst({ where: { id: resolvedWaNumberId, workspaceId } });
    if (!valid) resolvedWaNumberId = null;
  }
  if (!resolvedWaNumberId) {
    const defaultNumber = await prisma.waNumber.findFirst({
      where: { workspaceId, status: { in: ['ACTIVE', 'CONNECTED'] } },
    }) || await prisma.waNumber.findFirst({ where: { workspaceId } });
    resolvedWaNumberId = defaultNumber?.id || null;
  }

  if (conversation) {
    // An Instagram thread never gets a WhatsApp number attached: its replies
    // must keep going out through Instagram.
    if (!conversation.waNumberId && resolvedWaNumberId && conversation.channel !== 'INSTAGRAM') {
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
  realtime.conversationUpdated(workspaceId, conversation.id, 'created');

  return conversation;
}

export async function getMessages(workspaceId, conversationId, { limit, before } = {}) {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, workspaceId },
  });
  if (!conversation) { const e = new Error('Conversation not found'); e.status = 404; throw e; }

  // `before` (a message id) asks for history older than that message — the
  // inbox's "Load earlier messages". Reading history is not opening the
  // thread, so it leaves the unread count alone.
  let olderThan = null;
  if (before) {
    const pivot = await prisma.message.findFirst({
      where: { id: String(before), conversationId },
      select: { id: true, sentAt: true },
    });
    if (!pivot) { const e = new Error('Unknown message cursor'); e.status = 400; throw e; }
    olderThan = {
      OR: [
        { sentAt: { lt: pivot.sentAt } },
        { sentAt: pivot.sentAt, id: { lt: pivot.id } },
      ],
    };
  } else {
    await prisma.conversation.update({ where: { id: conversationId }, data: { unreadCount: 0 } });
    // Only when it changed: an open thread refetches on this, and must not loop.
    if (conversation.unreadCount > 0) realtime.conversationUpdated(workspaceId, conversationId, 'read');
  }

  // The newest `take` messages (before the cursor, if any), still returned
  // oldest-first. A years-long thread used to come back whole on every open
  // and every poll (CF-048); `hasMore` says whether older ones remain.
  const { take } = listWindow({ limit }, { defaultLimit: 500, maxLimit: 2000 });
  const newest = await prisma.message.findMany({
    where: { conversationId, ...(olderThan ?? {}) },
    orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
    include: { senderUser: { select: { id: true, name: true } } },
    take: take + 1,
  });
  const hasMore = newest.length > take;
  const messages = newest.slice(0, take).reverse();

  // The composer needs to know whether a free-form reply is even allowed before
  // the agent types one. Returned alongside the thread so the inbox can say
  // "the window closed, send a template" rather than letting the send fail.
  const window = windowStateFrom(conversation.lastInboundAt);

  return {
    messages,
    hasMore,
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
export function describeSendFailure(err) {
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

// Instagram threads take text only: there is no template to reopen a closed
// window with, and attachments are not sent from the inbox.
function assertWhatsAppThread(conversation, what) {
  if (conversation.channel !== 'INSTAGRAM') return;
  const e = new Error(`${what} can only be sent on WhatsApp conversations. Reply to this Instagram conversation with text.`);
  e.status = 409; e.code = 'NOT_SUPPORTED_ON_INSTAGRAM'; e.expose = true;
  throw e;
}

// An agent's reply in an Instagram thread. The same rules as a WhatsApp reply
// — opt-out, the 24-hour window, one metered credit refunded on failure — are
// enforced in deliverInstagramReply; this turns its outcome into the errors
// the composer already understands.
async function sendInstagramInboxReply(conversation, userId, body) {
  const { deliverInstagramReply } = await import('./instagram.service.js');
  const outcome = await deliverInstagramReply({
    conversationId: conversation.id, body, reason: 'Message overage', senderUserId: userId ?? null,
  });
  if (outcome.ok) {
    if (userId) markFirstResponseForConversation(conversation.workspaceId, conversation.id).catch((err) => console.warn(`[Conversations] First-response mark failed for ${conversation.id}:`, err.message));
    return outcome.message;
  }
  const errors = {
    EMPTY: [400, 'Message is empty'],
    OPTED_OUT: [409, 'This contact asked not to be messaged.'],
    WINDOW_CLOSED: [409, 'Instagram only allows a reply within 24 hours of the customer’s last message. Wait for them to write again.'],
    NO_CREDIT: [403, 'Message quota and wallet balance exhausted — recharge your wallet or upgrade your plan'],
    NOT_CONNECTED: [409, 'Instagram is not connected for this workspace — reconnect it under Automation → Instagram.'],
  };
  const [status, message] = errors[outcome.code] || [502, `Instagram refused the message: ${outcome.detail}`];
  const e = new Error(message);
  e.status = status;
  e.code = outcome.code === 'WINDOW_CLOSED' ? 'OUTSIDE_24H_WINDOW' : outcome.code;
  e.expose = true;
  throw e;
}

export async function sendMessage(workspaceId, conversationId, userId, { type, body, contactId, phoneNumber } = {}) {
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

  if (conversation.channel === 'INSTAGRAM') return sendInstagramInboxReply(conversation, userId, body);

  // The thread survives its number being disconnected, but there is nothing left
  // to send from — the history stays readable, replies do not.
  if (!conversation.waNumber) {
    const e = new Error('The WhatsApp number for this conversation was disconnected — connect a number to reply.');
    e.status = 409;
    throw e;
  }

  // Opt-out is checked on every outbound path, including a human replying
  // from the inbox — a customer who sent STOP must not be messaged again.
  await assertNotOptedOut(workspaceId, conversation.contact.phoneNumber);

  // WhatsApp's 24-hour rule, enforced locally. Meta accepts an out-of-window
  // free-form send synchronously and only reports 131047 later through the
  // status webhook, so a 200 from the send is not evidence the window is open.
  // Only a real inbound message (webhook) moves lastInboundAt.
  const windowState = await getWindowState(conversationId);
  if (!windowState.open) throw outsideWindowError(windowState);

  // Decrypt before charging: a token stored under a rotated key must not cost
  // a credit for a send that can never happen.
  const accessToken = decrypt(conversation.waNumber.encryptedAccessToken);

  const credit = await consumeMessageCredit(workspaceId, { reason: 'Message overage' });
  if (!credit.ok) {
    const e = new Error('Message quota and wallet balance exhausted — recharge your wallet or upgrade your plan');
    e.status = 403;
    throw e;
  }

  let result;
  try {
    result = await sendTextMessage(
      conversation.waNumber.metaPhoneNumberId,
      accessToken,
      conversation.contact.phoneNumber,
      body
    );
  } catch (err) {
    // The credit was consumed before the send. Nothing went out, so hand it
    // back rather than charging for a message that does not exist.
    await releaseMessageCredit(workspaceId, { source: credit.source, amount: credit.amount ?? null }); // never throws; logs its own failures
    throw describeSendFailure(err);
  }

  const message = await prisma.message.create({
    data: {
      conversationId,
      body,
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
  if (userId) markFirstResponseForConversation(workspaceId, conversationId).catch((err) => console.warn(`[Conversations] First-response mark failed for ${conversationId}:`, err.message));

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
  realtime.messageCreated(workspaceId, conversationId, { messageId: message.id, direction: 'OUTBOUND' });

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
  assertWhatsAppThread(conversation, 'Attachments');
  if (!conversation.waNumber) {
    const e = new Error('The WhatsApp number for this conversation was disconnected — connect a number to reply.');
    e.status = 409; throw e;
  }

  await assertNotOptedOut(workspaceId, conversation.contact.phoneNumber);

  // An attachment is a free-form message, so the same 24-hour rule applies.
  const windowState = await getWindowState(conversationId);
  if (!windowState.open) throw outsideWindowError(windowState);

  const accessToken = decrypt(conversation.waNumber.encryptedAccessToken);

  const credit = await consumeMessageCredit(workspaceId, { reason: 'Media message' });
  if (!credit.ok) {
    const e = new Error('Message quota and wallet balance exhausted — recharge your wallet or upgrade your plan');
    e.status = 403;
    throw e;
  }

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
    await releaseMessageCredit(workspaceId, { source: credit.source, amount: credit.amount ?? null }); // never throws; logs its own failures
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
  if (userId) markFirstResponseForConversation(workspaceId, conversationId).catch((err) => console.warn(`[Conversations] First-response mark failed for ${conversationId}:`, err.message));
  // Our own copy in file storage: Meta drops the media after ~30 days, and the
  // thread should still be able to show what was sent. Not awaited — the send
  // has happened either way.
  archiveOutboundMedia({ workspaceId, messageId: message.id, buffer, mimeType })
    .catch((err) => console.warn(`[Conversations] Could not archive sent media for message ${message.id}:`, err.message));

  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      lastMessageAt: new Date(),
      ...(userId ? { humanHandoffAt: new Date() } : {}),
    },
  });
  realtime.messageCreated(workspaceId, conversationId, { messageId: message.id, direction: 'OUTBOUND' });

  return message;
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
  assertWhatsAppThread(conversation, 'Templates');
  if (!conversation.waNumber) {
    const e = new Error('The WhatsApp number for this conversation was disconnected — connect a number to reply.');
    e.status = 409; throw e;
  }

  // Opt-out still applies. A template is not an exemption from someone asking
  // to be left alone — it is only an exemption from the timing rule.
  await assertNotOptedOut(workspaceId, conversation.contact.phoneNumber);

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

  const accessToken = decrypt(conversation.waNumber.encryptedAccessToken);

  const credit = await consumeMessageCredit(workspaceId, {
    reason: 'Template message',
    messageCategory: template.category ?? null,
  });
  if (!credit.ok) {
    const e = new Error('Message quota and wallet balance exhausted — recharge your wallet or upgrade your plan');
    e.status = 403;
    throw e;
  }

  const components = Array.isArray(template.components) ? template.components : [];
  const required = components.reduce((max, c) => Math.max(max, countVariables(c?.text)), 0);
  let supplied = (Array.isArray(variables) ? variables : []).map((v) => String(v ?? ''));
  if (required > 0 && supplied.filter((v) => v.trim()).length < required) {
    const resolver = contactVariableResolver(conversation.contact);
    const bodyComp = components.find((c) => /\{\{\d+\}\}/.test(c?.text || ''));
    supplied = Array.from({ length: required }, (_, i) => String(supplied[i] || resolver(i, bodyComp) || 'there'));
  }

  const resolve = (i, component) => String(supplied[i] ?? '').trim() || contactVariableResolver(conversation.contact)(i, component);

  const payload = await buildTemplateSendPayload(template, {
    workspaceId,
    phoneNumberId: conversation.waNumber.metaPhoneNumberId,
    accessToken,
    resolve,
  });

  let result;
  try {
    result = await sendWhatsAppMessage(
      conversation.waNumber.metaPhoneNumberId, accessToken,
      conversation.contact.phoneNumber, payload,
    );
  } catch (err) {
    await releaseMessageCredit(workspaceId, { source: credit.source, amount: credit.amount ?? null }); // never throws; logs its own failures
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
  if (userId) markFirstResponseForConversation(workspaceId, conversationId).catch((err) => console.warn(`[Conversations] First-response mark failed for ${conversationId}:`, err.message));

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { lastMessageAt: new Date() },
  });
  realtime.messageCreated(workspaceId, conversationId, { messageId: message.id, direction: 'OUTBOUND' });

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
  if (assignedToUserId) await assertWorkspaceMember(workspaceId, assignedToUserId, 'Assignee');
  const updated = await prisma.conversation.update({
    where: { id: conversationId },
    data: { assignedToUserId: assignedToUserId || null },
    include: { assignedTo: { select: { id: true, name: true } } },
  });
  realtime.conversationUpdated(workspaceId, conversationId, 'assigned');
  return updated;
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
  const updated = await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      status: next,
      // Resolving ends the human's ownership: a customer who writes again
      // starts a fresh exchange, and the automation should answer it.
      ...(next === 'RESOLVED' ? { humanHandoffAt: null } : {}),
    },
  });
  realtime.conversationUpdated(workspaceId, conversationId, 'status');
  return updated;
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
  realtime.conversationUpdated(workspaceId, conversationId, 'bot');
  return {
    botEnabled: updated.humanHandoffAt === null,
    humanHandoffAt: updated.humanHandoffAt,
  };
}
