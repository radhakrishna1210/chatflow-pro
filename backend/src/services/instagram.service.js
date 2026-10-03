import axios from 'axios';
import { prisma } from '../lib/prisma.js';
import { realtime } from '../lib/realtimeBus.js';
import { env } from '../config/env.js';
import { encrypt, decrypt } from '../lib/encryption.js';
import { handleInstagramMessage } from './instagramInbox.service.js';
import { keywordMatches } from './automation.service.js';
import { getWindowState } from './messagingWindow.js';
import { consumeMessageCredit, releaseMessageCredit } from './subscription.service.js';

// Instagram Quickflows used to be a static empty state: the "New IG Flow"
// button had no handler, the client ID was hardcoded in the frontend, and the
// OAuth callback threw the code away with a "real implementation would…"
// comment. This is that implementation.

// A token from Instagram Business Login (api.instagram.com/oauth) is an
// Instagram User token, which graph.facebook.com does not accept — sends and
// comment replies were posted there and could only fail. Everything after the
// OAuth exchange goes to graph.instagram.com.
const IG_GRAPH = 'https://graph.instagram.com';
const IG_OAUTH_TOKEN_URL = 'https://api.instagram.com/oauth/access_token';

// Instagram Business Login needs the *Instagram* app id and secret — the pair
// shown under the Instagram product in the Meta App Dashboard — not the
// Facebook app id used for WhatsApp.
//
// Falling back to META_APP_ID is what produced the reported "incorrect
// password" error, and the fallback is why it was so hard to place: the
// connection looked configured, the authorize URL built fine, and the failure
// surfaced on instagram.com as a login rejection rather than anywhere in this
// app. Instagram serves its own login form for an unrecognised client_id and
// then refuses the credentials, so the customer sees "incorrect password" for a
// password that is perfectly correct.
//
// So there is no fallback any more. Either the Instagram credentials are set,
// or the feature reports itself as unconfigured and says exactly which two
// values are missing.
const appId = () => env.INSTAGRAM_APP_ID;
const appSecret = () => env.INSTAGRAM_APP_SECRET;

export function instagramConfigured() {
  return Boolean(appId() && appSecret());
}

// What is missing, for the connection screen to show instead of a dead button.
export function instagramConfigStatus() {
  const missing = [];
  if (!env.INSTAGRAM_APP_ID) missing.push('INSTAGRAM_APP_ID');
  if (!env.INSTAGRAM_APP_SECRET) missing.push('INSTAGRAM_APP_SECRET');
  return {
    configured: missing.length === 0,
    missing,
    redirectUri: env.INSTAGRAM_REDIRECT_URI,
    // The two things that have to be true on Meta's side, stated plainly
    // because neither is discoverable from the error Instagram returns.
    setupNotes: missing.length === 0 ? [] : [
      'These are the Instagram app credentials from Meta App Dashboard → your app → Instagram → API setup with Instagram business login. They are not the Facebook App ID and secret used for WhatsApp.',
      `The redirect URI below must be listed verbatim under "Business login settings" in that same screen: ${env.INSTAGRAM_REDIRECT_URI}`,
    ],
  };
}

export function buildAuthUrl(workspaceId, state) {
  // Resolved in config/env.js off the shared backend base.
  const redirectUri = env.INSTAGRAM_REDIRECT_URI;
  const scopes = [
    'instagram_business_basic',
    'instagram_business_manage_messages',
    'instagram_business_manage_comments',
  ].join(',');

  const params = new URLSearchParams({
    client_id: appId(),
    redirect_uri: redirectUri,
    scope: scopes,
    response_type: 'code',
    state,
  });
  return { url: `https://www.instagram.com/oauth/authorize?${params}`, redirectUri };
}

// Short-lived code → long-lived (60 day) token, then persist encrypted.
export async function completeOAuth(workspaceId, code, redirectUri) {
  if (!instagramConfigured()) {
    const e = new Error('Instagram is not configured on this server (INSTAGRAM_APP_ID / INSTAGRAM_APP_SECRET).');
    e.status = 503;
    e.expose = true;
    throw e;
  }

  const form = new URLSearchParams({
    client_id: appId(),
    client_secret: appSecret(),
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
    code,
  });

  const { data: short } = await axios.post(IG_OAUTH_TOKEN_URL, form, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  const shortToken = short.access_token;
  const igUserId = String(short.user_id || '');

  const { data: long } = await axios.get('https://graph.instagram.com/access_token', {
    params: { grant_type: 'ig_exchange_token', client_secret: appSecret(), access_token: shortToken },
  });
  const accessToken = long.access_token || shortToken;

  let username = null;
  let accountId = igUserId;
  try {
    const { data: profile } = await axios.get('https://graph.instagram.com/me', {
      params: { fields: 'id,username,user_id', access_token: accessToken },
    });
    username = profile.username || null;
    // `user_id` is the professional account id — the `entry.id` webhooks are
    // addressed to. The token exchange's user_id is app-scoped and is only a
    // fallback.
    if (profile.user_id) accountId = String(profile.user_id);
  } catch (err) {
    console.warn('[Instagram] Could not read profile:', err.response?.data || err.message);
  }

  return prisma.workspace.update({
    where: { id: workspaceId },
    data: {
      instagramUserId: accountId,
      instagramUsername: username,
      instagramAccessToken: encrypt(accessToken),
      instagramConnectedAt: new Date(),
    },
    select: { instagramUserId: true, instagramUsername: true, instagramConnectedAt: true },
  });
}

export async function getConnection(workspaceId) {
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { instagramUserId: true, instagramUsername: true, instagramConnectedAt: true },
  });
  return {
    connected: Boolean(ws?.instagramConnectedAt),
    username: ws?.instagramUsername || null,
    userId: ws?.instagramUserId || null,
    connectedAt: ws?.instagramConnectedAt || null,
    configured: instagramConfigured(),
  };
}

export async function disconnect(workspaceId) {
  await prisma.workspace.update({
    where: { id: workspaceId },
    data: {
      instagramUserId: null,
      instagramUsername: null,
      instagramAccessToken: null,
      instagramConnectedAt: null,
    },
  });
}

// ── Flow CRUD ──────────────────────────────────────────────────────────────

const SOURCES = new Set(['dm', 'comment', 'story_reply']);

export async function listFlows(workspaceId) {
  return prisma.instagramFlow.findMany({ where: { workspaceId }, orderBy: { createdAt: 'desc' } });
}

export async function createFlow(workspaceId, { name, source, keyword, responseTemplate, alsoSendDm, isActive }) {
  return prisma.instagramFlow.create({
    data: {
      workspaceId,
      name,
      source: SOURCES.has(source) ? source : 'dm',
      keyword: String(keyword || '').trim().toUpperCase(),
      responseTemplate,
      alsoSendDm: !!alsoSendDm,
      isActive: isActive !== false,
    },
  });
}

export async function updateFlow(workspaceId, id, updates) {
  const flow = await prisma.instagramFlow.findFirst({ where: { id, workspaceId } });
  if (!flow) { const e = new Error('Flow not found'); e.status = 404; throw e; }

  const data = {};
  if (updates.name !== undefined) data.name = updates.name;
  if (updates.source !== undefined) data.source = SOURCES.has(updates.source) ? updates.source : flow.source;
  if (updates.keyword !== undefined) data.keyword = String(updates.keyword || '').trim().toUpperCase();
  if (updates.responseTemplate !== undefined) data.responseTemplate = updates.responseTemplate;
  if (updates.alsoSendDm !== undefined) data.alsoSendDm = !!updates.alsoSendDm;
  if (updates.isActive !== undefined) data.isActive = !!updates.isActive;

  return prisma.instagramFlow.update({ where: { id }, data });
}

export async function deleteFlow(workspaceId, id) {
  const flow = await prisma.instagramFlow.findFirst({ where: { id, workspaceId } });
  if (!flow) { const e = new Error('Flow not found'); e.status = 404; throw e; }
  await prisma.instagramFlow.delete({ where: { id } });
}

// ── Sending ────────────────────────────────────────────────────────────────

async function tokenFor(workspaceId) {
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { instagramAccessToken: true, instagramUserId: true },
  });
  if (!ws?.instagramAccessToken) return null;
  return { token: decrypt(ws.instagramAccessToken), igUserId: ws.instagramUserId };
}

// Instagram's quick replies: up to 13, titles of at most 20 characters. The
// tap comes back as an ordinary message whose text is the title.
export const IG_QUICK_REPLY_LIMITS = { count: 13, titleChars: 20 };

export async function sendDm(workspaceId, recipientId, text, { quickReplies = [] } = {}) {
  const auth = await tokenFor(workspaceId);
  if (!auth) return null;
  const replies = quickReplies.slice(0, IG_QUICK_REPLY_LIMITS.count)
    .map((t) => String(t).slice(0, IG_QUICK_REPLY_LIMITS.titleChars))
    .map((title) => ({ content_type: 'text', title, payload: title }));
  const { data } = await axios.post(
    `${IG_GRAPH}/${env.META_API_VERSION}/me/messages`,
    { recipient: { id: recipientId }, message: { text, ...(replies.length ? { quick_replies: replies } : {}) } },
    { headers: { Authorization: `Bearer ${auth.token}` }, timeout: 15_000 },
  );
  return data;
}

export async function replyToComment(workspaceId, commentId, text) {
  const auth = await tokenFor(workspaceId);
  if (!auth) return null;
  const { data } = await axios.post(
    `${IG_GRAPH}/${env.META_API_VERSION}/${commentId}/replies`,
    { message: text },
    { headers: { Authorization: `Bearer ${auth.token}` }, timeout: 15_000 },
  );
  return data;
}

// Name and handle of someone who messaged the account, for a new contact.
// Best effort: Instagram only answers for users who have messaged the account,
// and nothing depends on it.
export async function fetchInstagramProfile(workspaceId, igsid) {
  const auth = await tokenFor(workspaceId);
  if (!auth) return null;
  try {
    const { data } = await axios.get(`${IG_GRAPH}/${env.META_API_VERSION}/${encodeURIComponent(igsid)}`, {
      params: { fields: 'name,username' },
      headers: { Authorization: `Bearer ${auth.token}` },
      timeout: 10_000,
    });
    return { name: data?.name || null, username: data?.username || null };
  } catch (err) {
    console.warn('[Instagram] Could not read the sender profile:', err.response?.data?.error?.message || err.message);
    return null;
  }
}

/**
 * Every reply into an Instagram conversation — automation and inbox alike —
 * goes through here, with the same rules a WhatsApp reply has
 * (outbound.service.js#deliverAutomatedReply): the contact has not opted out,
 * the 24-hour messaging window (Instagram's standard window) is open, a
 * message credit is claimed first and handed back if Instagram refuses, and
 * the sent message is stored so it shows in the inbox.
 *
 * @returns {Promise<{ ok: true, message } | { ok: false, code: string, detail: string }>}
 *   codes: EMPTY, NOT_INSTAGRAM, NOT_CONNECTED, OPTED_OUT, WINDOW_CLOSED, NO_CREDIT, IG_REJECTED
 */
export async function deliverInstagramReply({
  conversationId, body, options = [], reason = 'Instagram automated reply', senderUserId = null, recordFailure = false,
}) {
  const text = String(body || '').trim();
  if (!text) return { ok: false, code: 'EMPTY', detail: 'Message was empty' };

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: { contact: true },
  });
  if (!conversation || conversation.channel !== 'INSTAGRAM' || !conversation.contact?.instagramUserId) {
    return { ok: false, code: 'NOT_INSTAGRAM', detail: 'Not an Instagram conversation' };
  }
  const { workspaceId, contact } = conversation;
  if (contact.optedOut) {
    console.log(`[Instagram] ${contact.instagramUserId} has opted out — reply suppressed.`);
    return { ok: false, code: 'OPTED_OUT', detail: 'Recipient opted out' };
  }

  const windowState = await getWindowState(conversationId);
  if (!windowState.open) {
    console.warn(`[Instagram] Reply on ${conversationId} suppressed — the 24-hour messaging window is closed.`);
    return { ok: false, code: 'WINDOW_CLOSED', detail: 'Instagram only allows a reply within 24 hours of the customer\'s last message' };
  }

  let credit;
  try {
    credit = await consumeMessageCredit(workspaceId, { reason });
  } catch (err) {
    console.error(`[Instagram] Could not meter the send for workspace ${workspaceId}:`, err.message);
    credit = { ok: false };
  }
  if (!credit?.ok) {
    return { ok: false, code: 'NO_CREDIT', detail: 'Message quota and wallet balance exhausted', creditCode: credit?.code };
  }
  const refund = () => releaseMessageCredit(workspaceId, { source: credit.source, amount: credit.amount ?? null })
    .catch((err) => console.error('[Instagram] Credit refund failed:', err.message));

  const choices = (Array.isArray(options) ? options : [])
    .map((o) => String(typeof o === 'string' ? o : o?.title ?? '').trim()).filter(Boolean);
  let result;
  try {
    result = await sendDm(workspaceId, contact.instagramUserId, text, { quickReplies: choices });
  } catch (err) {
    await refund();
    const igError = err.response?.data?.error;
    const detail = String(igError?.message || err.message || 'Instagram rejected the send').slice(0, 500);
    console.error('[Instagram] Send failed:', igError || err.message);
    if (recordFailure) {
      await prisma.message.create({
        data: {
          conversationId, body: text, direction: 'OUTBOUND', type: 'TEXT', status: 'FAILED',
          statusAt: new Date(), errorCode: Number.isFinite(Number(igError?.code)) ? Number(igError.code) : null,
          errorMessage: detail, sentAt: new Date(), senderUserId,
        },
      }).catch(() => {});
    }
    return { ok: false, code: 'IG_REJECTED', detail };
  }
  if (!result) {
    await refund();
    return { ok: false, code: 'NOT_CONNECTED', detail: 'Instagram is not connected for this workspace' };
  }

  const stored = choices.length ? [text, '', ...choices.map((c) => `• ${c}`)].join('\n') : text;
  const message = await prisma.message.create({
    data: {
      conversationId,
      body: stored,
      direction: 'OUTBOUND',
      type: 'TEXT',
      metaMessageId: result.message_id || null,
      status: 'SENT',
      statusAt: new Date(),
      sentAt: new Date(),
      senderUserId,
    },
    include: { senderUser: { select: { id: true, name: true } } },
  });
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { lastMessageAt: new Date(), ...(senderUserId ? { humanHandoffAt: new Date() } : {}) },
  });
  realtime.messageCreated(workspaceId, conversationId, { messageId: message.id, direction: 'OUTBOUND' });
  return { ok: true, message };
}

// ── Inbound webhook ────────────────────────────────────────────────────────

// An empty keyword means "match everything on this source"; otherwise the same
// whole-word matching WhatsApp triggers use. Longest keyword wins so a specific
// flow beats a catch-all.
export function pickFlow(flows, source, text) {
  return flows
    .filter((f) => f.source === source)
    .filter((f) => !f.keyword || keywordMatches(f.keyword, text))
    .sort((a, b) => b.keyword.length - a.keyword.length)[0];
}

export async function processInstagramWebhook(body) {
  for (const entry of body?.entry || []) {
    const igUserId = String(entry.id || '');
    const workspace = await prisma.workspace.findFirst({
      where: { instagramUserId: igUserId },
      select: { id: true },
    });
    if (!workspace) {
      console.warn(`[Instagram] No workspace connected for IG user ${igUserId} — event dropped.`);
      continue;
    }

    const flows = await prisma.instagramFlow.findMany({
      where: { workspaceId: workspace.id, isActive: true },
    });

    // DMs arrive under `messaging`, comments under `changes`. A DM used to be
    // answered only by a Quickflow and otherwise dropped: it never reached the
    // inbox, the workflows, the keyword triggers or the AI agent (CF-224). It
    // now goes through the same pipeline a WhatsApp message does
    // (instagramInbox.service.js), with Quickflows as its first step.
    for (const event of entry.messaging || []) {
      try {
        await handleInstagramMessage({ workspaceId: workspace.id, accountId: igUserId, event, flows, pickFlow });
      } catch (err) {
        console.error('[Instagram] DM handling failed:', err.response?.data || err.message);
      }
    }

    if (flows.length === 0) continue;
    for (const change of entry.changes || []) {
      if (change.field !== 'comments') continue;
      const value = change.value || {};
      const text = value.text || '';
      // Our own replies come back as comment events too.
      if (!text || String(value.from?.id || '') === igUserId) continue;

      const flow = pickFlow(flows, 'comment', text);
      if (!flow) continue;

      try {
        await replyToComment(workspace.id, value.id, flow.responseTemplate);
        if (flow.alsoSendDm && value.from?.id) {
          await sendDm(workspace.id, value.from.id, flow.responseTemplate).catch((err) =>
            console.error('[Instagram] Comment→DM failed:', err.response?.data || err.message));
        }
        await prisma.instagramFlow.update({ where: { id: flow.id }, data: { triggeredCount: { increment: 1 } } });
      } catch (err) {
        console.error('[Instagram] Comment reply failed:', err.response?.data || err.message);
      }
    }
  }
}
