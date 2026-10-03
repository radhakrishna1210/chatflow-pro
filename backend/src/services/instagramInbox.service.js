import { prisma } from '../lib/prisma.js';
import { realtime } from '../lib/realtimeBus.js';
import { safeRequest } from '../lib/safeUrl.js';
import { storage, keys } from '../lib/storage/index.js';
import { findMatchingTrigger } from './automation.service.js';
import { matchIntent, generateAgentReply } from './aiAgent.service.js';
import { runWorkflowsForInbound, runWillSendMessage, resumeAwaitingRun } from './workflowEngine.service.js';
import { matchOptOutKeyword } from './optout.service.js';
import { isWithinBusinessHours } from './businessHours.service.js';
import { escalateToHuman, escalationMatch, escalationRulesApply } from './intentRouting.service.js';
import { resolveHandoff } from './automationPause.service.js';
import { recordSuppressedAutomation, SUPPRESSION_REASONS } from './automationSuppression.service.js';
import { emitWebhook } from './outgoingWebhook.service.js';
import { notifyWorkspace } from './notification.service.js';
import { transcribeVoiceNote } from './inboundMedia.service.js';
import { deliverInstagramReply, fetchInstagramProfile } from './instagram.service.js';

// Instagram DMs in the inbox and through the automation (CF-224).
//
// Before this, an Instagram DM was answered by a matching Quickflow or not at
// all: it was never stored, so the inbox never showed it, and none of the
// workspace's workflows, keyword triggers or AI agent ever saw it.
//
// The order mirrors the WhatsApp pipeline (webhook.service.js#handleInboundMessage)
// minus what is WhatsApp-only — campaign AI chats, WhatsApp forms, intent
// routing (its actions send WhatsApp messages) and the delayed-response check:
//
//   store → handoff (lapses) → opt-out → waiting workflow run → workflow
//   triggers → keyword Quickflows → keyword trigger → fuzzy intent →
//   escalation rules (agent deployed) → welcome / out-of-office → catch-all
//   Quickflow → AI agent
//
// Every reply goes through instagram.service.js#deliverInstagramReply, which
// enforces the 24-hour window, the opt-out and the message metering.

const WELCOME_GAP_MS = 24 * 60 * 60 * 1000;

// Instagram attachment types -> Message.type.
const ATTACHMENT_TYPES = {
  image: 'IMAGE',
  video: 'VIDEO',
  audio: 'AUDIO',
  file: 'DOCUMENT',
  animated_image: 'IMAGE',
  sticker: 'STICKER',
};
const PLACEHOLDER = {
  IMAGE: '[photo]',
  VIDEO: '[video]',
  AUDIO: '[voice message]',
  DOCUMENT: '[document]',
  STICKER: '[sticker]',
};
// Shares of posts, reels and story mentions carry a link, not something the
// customer wrote.
const SHARE_PLACEHOLDER = {
  share: '[shared post]',
  ig_reel: '[shared reel]',
  reel: '[shared reel]',
  story_mention: '[mentioned you in a story]',
  ig_post: '[shared post]',
};

// Instagram's CDNs. Attachment URLs come from a signed webhook, but are still
// checked before anything is fetched from them.
const IG_MEDIA_HOST = /(^|\.)(cdninstagram\.com|fbcdn\.net|fbsbx\.com|instagram\.com)$/i;
const MEDIA_MAX_BYTES = 25 * 1024 * 1024;

// A Contact must have a phone number (it is the WhatsApp identity and is
// unique per workspace). An Instagram-only contact gets a stand-in built from
// its IGSID with the digits turned into letters: unique and stable, and — with
// no digits at all — rejected by every phone check, so no campaign, sequence or
// inbox path can ever try to WhatsApp it.
export function instagramPlaceholderPhone(igsid) {
  return `ig:${String(igsid).replace(/\d/g, (d) => 'abcdefghij'[Number(d)])}`;
}

/**
 * Normalises one `messaging` event. Null for anything that is not a new
 * message from the customer (echoes of our own sends, deletions, reactions,
 * read receipts, postbacks without text).
 */
export function parseInstagramEvent(event, accountId) {
  const m = event?.message;
  if (!m || m.is_echo || m.is_deleted) return null;
  const senderId = String(event.sender?.id || '');
  if (!senderId || senderId === String(accountId)) return null;

  const text = String(m.text || '').trim();
  const attachment = Array.isArray(m.attachments) ? m.attachments[0] : null;
  let type = 'TEXT';
  let body = text;
  let media = null;

  if (attachment) {
    const kind = String(attachment.type || '').toLowerCase();
    if (ATTACHMENT_TYPES[kind]) {
      type = ATTACHMENT_TYPES[kind];
      body = text || PLACEHOLDER[type];
      media = { mediaUrl: attachment.payload?.url || null, mediaMimeType: null };
    } else if (!text) {
      type = 'UNSUPPORTED';
      body = SHARE_PLACEHOLDER[kind] || `[unsupported message${kind ? `: ${kind}` : ''}]`;
    }
  } else if (!text) {
    if (!m.is_unsupported) return null;
    type = 'UNSUPPORTED';
    body = '[unsupported message]';
  }

  return {
    mid: m.mid,
    senderId,
    type,
    body,
    // Only words the customer typed (or a quick reply they tapped) count as
    // text for the automation; a placeholder never does. Text sent with a
    // photo or video is the customer's own words, so it counts (WF-IN-8).
    text,
    media,
    storyReply: Boolean(m.reply_to?.story),
    sentAt: Number.isFinite(Number(event.timestamp)) ? new Date(Number(event.timestamp)) : new Date(),
  };
}

async function ensureContact(workspaceId, igsid) {
  const found = await prisma.contact.findFirst({ where: { workspaceId, instagramUserId: igsid } });
  if (found) return { contact: found, isNew: false };
  const profile = await fetchInstagramProfile(workspaceId, igsid).catch(() => null);
  try {
    const contact = await prisma.contact.create({
      data: {
        workspaceId,
        name: profile?.name || (profile?.username ? `@${profile.username}` : 'Instagram user'),
        phoneNumber: instagramPlaceholderPhone(igsid),
        instagramUserId: igsid,
        instagramUsername: profile?.username || null,
        tags: ['instagram'],
      },
    });
    import('./outgoingWebhook.service.js')
      .then((m) => m.emitContactCreated?.(workspaceId, contact, { source: 'instagram' }))
      .catch((err) => console.warn('[Webhook:out] contact.created not sent:', err.message));
    return { contact, isNew: true };
  } catch (err) {
    // Two DMs from a new sender racing each other: converge on the winner.
    if (err.code !== 'P2002') throw err;
    const winner = await prisma.contact.findFirst({ where: { workspaceId, instagramUserId: igsid } });
    if (!winner) throw err;
    return { contact: winner, isNew: false };
  }
}

async function ensureConversation(workspaceId, contactId) {
  const where = { workspaceId, contactId, channel: 'INSTAGRAM' };
  const found = await prisma.conversation.findFirst({ where });
  if (found) return found;
  try {
    return await prisma.conversation.create({ data: { ...where, status: 'OPEN', waNumberId: null } });
  } catch (err) {
    const retry = await prisma.conversation.findFirst({ where });
    if (retry) return retry;
    throw err;
  }
}

// Instagram's attachment URLs expire, so the bytes are kept (lib/storage). A
// voice note is also transcribed, exactly as on WhatsApp.
async function keepMedia({ workspaceId, messageId, parsed }) {
  const url = parsed.media?.mediaUrl;
  if (!url) return { transcript: null };
  let res;
  try {
    const target = new URL(url);
    if (target.protocol !== 'https:' || !IG_MEDIA_HOST.test(target.hostname)) {
      console.warn(`[InstagramInbox] Attachment of ${messageId} is not on an Instagram CDN — not fetched.`);
      return { transcript: null };
    }
    res = await safeRequest(target.toString(), { timeout: 30_000, maxBytes: MEDIA_MAX_BYTES, maxRedirects: 2, protocols: ['https:'] });
  } catch (err) {
    console.warn(`[InstagramInbox] Attachment of ${messageId} not downloaded: ${err.message}`);
    return { transcript: null };
  }
  if (res.status !== 200) return { transcript: null };
  const mimeType = String(res.headers?.['content-type'] || 'application/octet-stream').split(';')[0].trim();
  const key = keys.messageMedia(workspaceId, messageId);
  try {
    await storage.put(key, res.data, { contentType: mimeType });
    await prisma.message.update({
      where: { id: messageId },
      data: { mediaStorageKey: key, mediaSize: res.data.length, mediaMimeType: mimeType },
    });
  } catch (err) {
    console.warn(`[InstagramInbox] Attachment of ${messageId} not archived: ${err.message}`);
  }
  if (parsed.type !== 'AUDIO') return { transcript: null };
  const { text, reason } = await transcribeVoiceNote({ buffer: res.data, mimeType });
  if (!text) {
    console.log(`[InstagramInbox] Voice note ${messageId} not transcribed (${reason}) — routed as an audio message.`);
    return { transcript: null };
  }
  await prisma.message.update({ where: { id: messageId }, data: { transcript: text, body: text } })
    .catch((err) => console.warn(`[InstagramInbox] Transcript of ${messageId} not saved: ${err.message}`));
  return { transcript: text };
}

async function reply(conversationId, body, options) {
  const outcome = await deliverInstagramReply({ conversationId, body, options });
  if (!outcome.ok) console.warn(`[InstagramInbox] Reply on ${conversationId} not sent — ${outcome.code}: ${outcome.detail}`);
  return outcome;
}

/**
 * One inbound Instagram `messaging` event, end to end.
 *
 * @param {object} args
 * @param {string} args.workspaceId
 * @param {string} args.accountId   the connected professional account (entry.id)
 * @param {object} args.event       one element of entry.messaging
 * @param {object[]} args.flows     the workspace's active Quickflows
 * @param {Function} args.pickFlow  Quickflow matcher (instagram.service.js)
 * @returns {Promise<{ handled: boolean, step?: string, conversationId?: string }>}
 */
export async function handleInstagramMessage({ workspaceId, accountId, event, flows = [], pickFlow }) {
  const parsed = parseInstagramEvent(event, accountId);
  if (!parsed) return { handled: false };

  const { contact, isNew } = await ensureContact(workspaceId, parsed.senderId);
  const conversation = await ensureConversation(workspaceId, contact.id);
  const previousLastMessageAt = conversation.lastMessageAt ?? null;
  // Read before this message reopens the thread (see resolveHandoff).
  const previousStatus = conversation.status ?? null;

  // Idempotent on Instagram's message id, like WhatsApp's: a redelivered
  // webhook must not store the message twice or answer it twice.
  let stored;
  try {
    stored = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        body: parsed.body,
        direction: 'INBOUND',
        type: parsed.type,
        metaMessageId: parsed.mid || null,
        status: 'DELIVERED',
        statusAt: parsed.sentAt,
        sentAt: parsed.sentAt,
        ...(parsed.media ? { mediaUrl: parsed.media.mediaUrl } : {}),
      },
    });
  } catch (err) {
    if (err.code === 'P2002') {
      console.log(`[InstagramInbox] Duplicate delivery of ${parsed.mid} — already processed.`);
      return { handled: false, step: 'duplicate' };
    }
    throw err;
  }

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      unreadCount: { increment: 1 },
      lastMessageAt: new Date(),
      // Instagram's standard messaging window is the same 24 hours, counted
      // from this message (messagingWindow.js).
      lastInboundAt: parsed.sentAt,
      ...(conversation.status !== 'OPEN' ? { status: 'OPEN' } : {}),
    },
  });
  realtime.messageCreated(workspaceId, conversation.id, { messageId: stored.id, direction: 'INBOUND' });

  let messageBody = parsed.text;
  if (parsed.media) {
    const media = await keepMedia({ workspaceId, messageId: stored.id, parsed }).catch(() => ({ transcript: null }));
    if (media.transcript) messageBody = media.transcript;
  }
  const customerText = Boolean(messageBody);
  const mediaType = parsed.media ? parsed.type.toLowerCase() : null;

  emitWebhook(workspaceId, 'message.received', {
    conversationId: conversation.id,
    channel: 'instagram',
    contact: { id: contact.id, name: contact.name, instagramUserId: contact.instagramUserId },
    message: {
      id: parsed.mid,
      type: parsed.type,
      body: customerText ? messageBody : parsed.body,
      from: parsed.senderId,
      timestamp: parsed.sentAt.toISOString(),
      ...(messageBody && parsed.type === 'AUDIO' ? { transcript: messageBody } : {}),
    },
  });

  // A person is holding the thread. The hold lapses after HANDOFF_TTL_HOURS
  // with no reply from them, or once the thread was closed (WF-IN-1).
  const handoff = await resolveHandoff(conversation, { previousStatus, workspaceId });
  const match = { messageBody: messageBody || parsed.body, event: customerText ? 'message' : 'media', mediaType, isNewContact: isNew };
  const suppressed = (reason) => recordSuppressedAutomation({
    workspaceId, conversationId: conversation.id, contactId: contact.id, reason, match,
  });
  if (handoff.paused) {
    await suppressed(SUPPRESSION_REASONS.handoff(handoff.reasonText));
    return { handled: false, step: 'human', conversationId: conversation.id };
  }

  // Opt-out. Instagram has no STOP convention of its own, but a customer who
  // writes it means it: the contact is flagged and every send path refuses it.
  const optOutKeyword = customerText ? matchOptOutKeyword(messageBody) : null;
  if (optOutKeyword) {
    await prisma.contact.update({ where: { id: contact.id }, data: { optedOut: true, optedOutAt: new Date() } })
      .catch((err) => console.error('[InstagramInbox] Could not record opt-out:', err.message));
    await notifyWorkspace(workspaceId, {
      type: 'OPT_OUT',
      title: 'A contact opted out',
      body: `${contact.name || 'An Instagram user'} asked not to be messaged on Instagram.`,
      link: 'inbox',
      meta: { conversationId: conversation.id },
    }).catch((err) => console.warn('[InstagramInbox] Opt-out notification failed:', err.message));
    await suppressed(SUPPRESSION_REASONS.optout(optOutKeyword));
    return { handled: true, step: 'optout', conversationId: conversation.id };
  }

  // 1. A workflow waiting on this customer's answer takes it first, then
  //    workflow triggers. Message and button steps send through
  //    deliverInstagramReply (outbound.service.js routes an Instagram
  //    conversation there); template steps are WhatsApp-only and are skipped.
  //
  //    Quickflows used to run before both, so a catch-all Quickflow ("blank =
  //    every DM") answered every message — including the answer to a
  //    workflow's question — and no Instagram workflow ever ran (WF-IN-15).
  //    A photo with no text does not answer a waiting question.
  let workflowWillReply = false;
  try {
    const resumed = customerText ? await resumeAwaitingRun(workspaceId, conversation.id, messageBody) : null;
    const runs = resumed ? [resumed] : await runWorkflowsForInbound(workspaceId, {
      ...match,
      conversationId: conversation.id,
      contactId: contact.id,
    });
    workflowWillReply = runs.some(runWillSendMessage);
  } catch (err) {
    console.error('[InstagramInbox] Workflow execution failed:', err);
  }
  if (workflowWillReply) return { handled: true, step: 'workflow', conversationId: conversation.id };

  // 2. Quickflows with a keyword — the Instagram-specific keyword replies.
  //    The catch-all ones (no keyword) wait until everything more specific
  //    has had its turn (step 6).
  const source = parsed.storyReply ? 'story_reply' : 'dm';
  const sendQuickflow = async (flow) => {
    const sent = await reply(conversation.id, flow.responseTemplate);
    if (sent.ok) {
      await prisma.instagramFlow.update({ where: { id: flow.id }, data: { triggeredCount: { increment: 1 } } })
        .catch((err) => console.warn(`[InstagramInbox] Could not count a trigger of flow ${flow.id}:`, err.message));
    }
    return { handled: true, step: 'quickflow', conversationId: conversation.id };
  };
  const keywordFlows = flows.filter((f) => String(f.keyword || '').trim());
  const catchAllFlows = flows.filter((f) => !String(f.keyword || '').trim());
  if (customerText && pickFlow) {
    const flow = pickFlow(keywordFlows, source, messageBody);
    if (flow) return sendQuickflow(flow);
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      autoWelcomeEnabled: true, autoOooEnabled: true, welcomeMessage: true, oooMessage: true,
      businessHours: true, aiAgentEnabled: true, escalationRules: true,
    },
  });

  let replyText = null;
  let step = null;
  if (customerText) {
    // 3. Keyword trigger, then the fuzzy intent match.
    const trigger = await findMatchingTrigger(workspaceId, messageBody);
    if (trigger) { replyText = trigger.responseTemplate; step = 'trigger'; }
    if (!replyText) {
      const intent = await matchIntent(workspaceId, messageBody).catch(() => null);
      if (intent?.trigger) { replyText = intent.trigger.responseTemplate; step = 'intent'; }
    }
    // 4. The AI agent's escalation rules — only while an agent is deployed,
    //    and only once the workspace's own automations had their turn.
    if (!replyText && escalationRulesApply(workspace)) {
      const hit = escalationMatch(messageBody, workspace.escalationRules);
      if (hit) {
        await escalateToHuman({ workspaceId, conversationId: conversation.id, contact, reason: hit.reason, reasonCode: hit.reasonCode });
        return { handled: true, step: 'escalated', conversationId: conversation.id };
      }
    }
  }

  // 5. Welcome / out-of-office.
  if (!replyText) {
    const returning = !isNew && previousLastMessageAt
      && Date.now() - new Date(previousLastMessageAt).getTime() > WELCOME_GAP_MS;
    if (workspace?.autoWelcomeEnabled && workspace.welcomeMessage && (isNew || returning)) {
      replyText = workspace.welcomeMessage; step = 'welcome';
    } else if (workspace?.autoOooEnabled && workspace.oooMessage && !isWithinBusinessHours(workspace.businessHours)) {
      replyText = workspace.oooMessage; step = 'ooo';
    }
  }

  // 6. A catch-all Quickflow ("every DM"), last of the configured replies.
  if (!replyText && customerText && pickFlow) {
    const flow = pickFlow(catchAllFlows, source, messageBody);
    if (flow) return sendQuickflow(flow);
  }

  // 7. The AI agent, when one is deployed. With nothing to say the DM is left
  //    for the inbox; the contact is not handed off (WF-IN-4).
  if (!replyText && customerText) {
    replyText = await generateAgentReply(workspaceId, messageBody, {
      contactName: contact.name, conversationId: conversation.id,
    }).catch(() => null);
    if (replyText) step = 'agent';
    else if (workspace?.aiAgentEnabled) {
      console.log(`[InstagramInbox] The AI agent produced no reply on ${conversation.id} — left for the inbox.`);
    }
  }

  if (!replyText) return { handled: false, step: 'unanswered', conversationId: conversation.id };
  await reply(conversation.id, replyText);
  return { handled: true, step, conversationId: conversation.id };
}
