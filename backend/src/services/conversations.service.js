import { prisma } from '../lib/prisma.js';
import { generateAgentReply } from './aiAgent.service.js';
import { decrypt } from '../lib/encryption.js';
import { sendTextMessage } from '../lib/meta.js';
import { getWindowState, outsideWindowError, windowStateFrom, describeWindow } from './messagingWindow.js';
import { consumeMessageCredit, releaseMessageCredit } from './subscription.service.js';
import { assertNotOptedOut } from './optout.service.js';

export async function listConversations(workspaceId, { page = 1, limit = 20 } = {}) {
  const skip = (page - 1) * limit;
  const [data, total] = await Promise.all([
    prisma.conversation.findMany({
      where: { workspaceId },
      skip,
      take: limit,
      orderBy: { lastMessageAt: 'desc' },
      include: {
        contact: { select: { id: true, name: true, phoneNumber: true } },
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
    prisma.conversation.count({ where: { workspaceId } }),
  ]);
  return { data, total };
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

export async function sendMessage(workspaceId, conversationId, userId, { type, body }) {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, workspaceId },
    include: { contact: true, waNumber: true },
  });
  if (!conversation) { const e = new Error('Conversation not found'); e.status = 404; throw e; }

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

  // WhatsApp's 24-hour rule. Checked here rather than discovered at Meta,
  // because the rejection that comes back (error 131047) reached the agent as
  // an unexplained 400 — and, crucially, the message credit below had already
  // been spent by then.
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
      body
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

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { lastMessageAt: new Date() },
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

  await assertNotOptedOut(workspaceId, conversation.contact.phoneNumber);

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
    data: { lastMessageAt: new Date() },
  });

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
  return prisma.conversation.update({ where: { id: conversationId }, data: { status: next } });
}
