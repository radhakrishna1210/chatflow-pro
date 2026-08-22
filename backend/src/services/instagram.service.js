import axios from 'axios';
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import { encrypt, decrypt } from '../lib/encryption.js';
import { keywordMatches } from './automation.service.js';

// Instagram Quickflows used to be a static empty state: the "New IG Flow"
// button had no handler, the client ID was hardcoded in the frontend, and the
// OAuth callback threw the code away with a "real implementation would…"
// comment. This is that implementation.

const GRAPH = 'https://graph.facebook.com';
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
  try {
    const { data: profile } = await axios.get('https://graph.instagram.com/me', {
      params: { fields: 'id,username', access_token: accessToken },
    });
    username = profile.username || null;
  } catch (err) {
    console.warn('[Instagram] Could not read profile:', err.response?.data || err.message);
  }

  return prisma.workspace.update({
    where: { id: workspaceId },
    data: {
      instagramUserId: igUserId,
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

export async function sendDm(workspaceId, recipientId, text) {
  const auth = await tokenFor(workspaceId);
  if (!auth) return null;
  const { data } = await axios.post(
    `${GRAPH}/${env.META_API_VERSION}/${auth.igUserId}/messages`,
    { recipient: { id: recipientId }, message: { text } },
    { params: { access_token: auth.token } },
  );
  return data;
}

export async function replyToComment(workspaceId, commentId, text) {
  const auth = await tokenFor(workspaceId);
  if (!auth) return null;
  const { data } = await axios.post(
    `${GRAPH}/${env.META_API_VERSION}/${commentId}/replies`,
    { message: text },
    { params: { access_token: auth.token } },
  );
  return data;
}

// ── Inbound webhook ────────────────────────────────────────────────────────

// An empty keyword means "match everything on this source"; otherwise the same
// whole-word matching WhatsApp triggers use. Longest keyword wins so a specific
// flow beats a catch-all.
function pickFlow(flows, source, text) {
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
    if (flows.length === 0) continue;

    // DMs arrive under `messaging`, comments under `changes`.
    for (const event of entry.messaging || []) {
      // Echoes are our own outbound DMs coming back — replying to them would
      // put the account in a loop with itself.
      if (event.message?.is_echo) continue;
      const text = event.message?.text || '';
      if (!text) continue;

      const source = event.message?.reply_to?.story ? 'story_reply' : 'dm';
      const flow = pickFlow(flows, source, text);
      if (!flow) continue;

      try {
        await sendDm(workspace.id, event.sender?.id, flow.responseTemplate);
        await prisma.instagramFlow.update({ where: { id: flow.id }, data: { triggeredCount: { increment: 1 } } });
      } catch (err) {
        console.error('[Instagram] DM reply failed:', err.response?.data || err.message);
      }
    }

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
