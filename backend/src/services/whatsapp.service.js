import { prisma } from '../lib/prisma.js';
import { encrypt, decrypt } from '../lib/encryption.js';
import {
  getWabaPhoneNumbers, systemClient, subscribeAppToWaba, getSubscribedApps,
  exchangeEmbeddedSignupCode, getLongLivedToken, registerPhoneNumber, getPhoneNumberById,
} from '../lib/meta.js';
import { syncTemplatesFromMeta } from './templates.service.js';
import { env } from '../config/env.js';

// Subscribe our Meta app to a WABA so webhooks (inbound messages, delivery/read
// receipts, template status) start flowing. Without this, the Inbox stays empty
// and campaign delivered/read counters never update. Marks the WaNumber row so
// the UI can show subscription status. Non-fatal on failure — the number is
// still usable for outbound, we just log loudly.
async function ensureWabaSubscribed(waNumberId, wabaId, accessToken) {
  try {
    await subscribeAppToWaba(wabaId, accessToken);
    if (waNumberId) {
      await prisma.waNumber.update({ where: { id: waNumberId }, data: { appSubscribed: true } }).catch(() => {});
    }
    console.log(`[whatsapp] Subscribed app to WABA ${wabaId}`);
    return true;
  } catch (err) {
    console.error(`[whatsapp] subscribeAppToWaba(${wabaId}) failed — webhooks will NOT arrive:`, err.response?.data?.error?.message || err.message);
    return false;
  }
}

// Refresh quality/status of numbers already assigned to this workspace — never creates new records.
async function refreshExistingFromMeta(workspaceId) {
  try {
    const metaNumbers = await getWabaPhoneNumbers(env.META_WABA_ID);
    for (const num of metaNumbers) {
      const exists = await prisma.waNumber.findFirst({
        where: { workspaceId, metaPhoneNumberId: num.id },
      });
      if (!exists) continue;
      await prisma.waNumber.update({
        where: { id: exists.id },
        data: {
          phoneNumber: num.display_phone_number,
          displayName: num.verified_name ?? exists.displayName,
          quality:     num.quality_rating  ?? exists.quality,
          status:      num.status          ?? exists.status,
        },
      });
    }
  } catch (err) {
    console.error('[whatsapp] Meta refresh failed:', err.message);
  }
}

export async function listNumbers(workspaceId) {
  const numbers = await prisma.waNumber.findMany({
    where: { workspaceId },
    orderBy: { createdAt: 'desc' },
  });
  return numbers.map(({ encryptedAccessToken: _, ...n }) => n);
}

export async function refreshNumbers(workspaceId) {
  await refreshExistingFromMeta(workspaceId);
  const numbers = await prisma.waNumber.findMany({
    where: { workspaceId },
    orderBy: { createdAt: 'desc' },
  });
  return numbers.map(({ encryptedAccessToken: _, ...n }) => n);
}

export async function connectOwnNumber(workspaceId, { phoneNumber, metaPhoneNumberId, wabaId, accessToken, displayName }) {
  if (!phoneNumber || !metaPhoneNumberId || !wabaId || !accessToken) {
    const e = new Error('phoneNumber, metaPhoneNumberId, wabaId and accessToken are required');
    e.status = 400;
    throw e;
  }
  const encryptedAccessToken = encrypt(accessToken);
  const number = await prisma.waNumber.create({
    data: { workspaceId, phoneNumber, metaPhoneNumberId, wabaId, encryptedAccessToken, displayName },
  });

  // Register for webhook events so the Inbox and delivery counters actually work.
  const subscribed = await ensureWabaSubscribed(number.id, wabaId, accessToken);
  // Pull any existing approved templates from Meta for this number.
  syncTemplatesFromMeta(workspaceId, number.id).catch(() => {});

  const { encryptedAccessToken: _omit, ...safe } = number;
  return { ...safe, appSubscribed: subscribed };
}

// ─── Embedded Signup completion ───────────────────────────────────────────────
// Called after the frontend FB.login dialog returns { code, wabaId, phoneNumberId }.
// Exchanges the code → long-lived token, registers the number, subscribes the app
// to the WABA (so webhooks flow), upserts the WaNumber, and syncs templates.
export async function completeEmbeddedSignup(workspaceId, { code, wabaId, phoneNumberId }) {
  if (!code || !wabaId || !phoneNumberId) {
    const e = new Error('code, wabaId and phoneNumberId are required'); e.status = 400; throw e;
  }

  // 1. Code → access token (Embedded Signup code flow, no redirect_uri)
  const tokenRes = await exchangeEmbeddedSignupCode(code);
  let accessToken = tokenRes.access_token;
  // 2. Upgrade to a long-lived token where possible
  try {
    const longRes = await getLongLivedToken(accessToken);
    if (longRes.access_token) accessToken = longRes.access_token;
  } catch (err) {
    console.warn('[whatsapp] long-lived token exchange failed, using short token:', err.response?.data?.error?.message || err.message);
  }

  // 3. Subscribe the app to the WABA (critical for webhooks)
  await subscribeAppToWaba(wabaId, accessToken);

  // 4. Register the phone number on Cloud API (needed before it can send)
  await registerPhoneNumber(phoneNumberId, accessToken).catch((err) => {
    console.warn('[whatsapp] registerPhoneNumber warning:', err.response?.data?.error?.message || err.message);
  });

  // 5. Fetch canonical number details
  const details = await getPhoneNumberById(phoneNumberId, accessToken).catch(() => ({}));

  const encryptedAccessToken = encrypt(accessToken);
  const existing = await prisma.waNumber.findFirst({ where: { workspaceId, metaPhoneNumberId: phoneNumberId } });
  const data = {
    workspaceId,
    phoneNumber: details.display_phone_number || existing?.phoneNumber || phoneNumberId,
    metaPhoneNumberId: phoneNumberId,
    wabaId,
    encryptedAccessToken,
    displayName: details.verified_name || existing?.displayName || null,
    status: details.status || 'ACTIVE',
    quality: details.quality_rating || null,
    appSubscribed: true,
  };

  const number = existing
    ? await prisma.waNumber.update({ where: { id: existing.id }, data })
    : await prisma.waNumber.create({ data });

  syncTemplatesFromMeta(workspaceId, number.id).catch(() => {});

  const { encryptedAccessToken: _o, ...safe } = number;
  return safe;
}

export function getEmbeddedSignupConfig() {
  return {
    appId: env.META_APP_ID,
    configId: env.META_ES_CONFIG_ID || null,
    graphVersion: env.META_API_VERSION,
  };
}

// Diagnostic: is this workspace's number actually subscribed on Meta's side?
export async function checkSubscription(workspaceId, numberId) {
  const n = await prisma.waNumber.findFirst({ where: { id: numberId, workspaceId } });
  if (!n) { const e = new Error('Number not found'); e.status = 404; throw e; }
  const apps = await getSubscribedApps(n.wabaId, decrypt(n.encryptedAccessToken));
  const subscribed = apps.some((a) => String(a.whatsapp_business_api_data?.id || a.id) === String(env.META_APP_ID)) || apps.length > 0;
  if (subscribed !== n.appSubscribed) {
    await prisma.waNumber.update({ where: { id: n.id }, data: { appSubscribed: subscribed } }).catch(() => {});
  }
  return { subscribed, wabaId: n.wabaId };
}

export async function listPool() {
  const pool = await prisma.numberPool.findMany({
    where: { status: 'AVAILABLE' },
    orderBy: { createdAt: 'desc' },
  });
  return pool.map(({ encryptedAccessToken: _, ...p }) => p);
}

export async function onboardFromPool(workspaceId, poolEntryId) {
  const entry = await prisma.numberPool.findUnique({ where: { id: poolEntryId } });
  if (!entry || entry.status !== 'AVAILABLE') {
    const err = new Error('Pool entry not available');
    err.status = 404;
    throw err;
  }

  // Attempt to create an isolated sub-WABA for this workspace
  let wabaId = entry.wabaId;
  try {
    const { data } = await systemClient.post(`/${env.META_BUSINESS_ID}/owned_whatsapp_business_accounts`, {
      name: `Workspace ${workspaceId}`,
    });
    if (data?.id) wabaId = data.id;
  } catch {
    // Fallback to shared WABA — non-fatal
  }

  // Atomic: mark pool entry ASSIGNED + create WaNumber record
  const [number] = await prisma.$transaction([
    prisma.waNumber.create({
      data: {
        workspaceId,
        phoneNumber:          entry.phoneNumber,
        metaPhoneNumberId:    entry.phoneNumberId,
        wabaId,
        encryptedAccessToken: entry.encryptedAccessToken,
        displayName:          entry.displayName,
      },
    }),
    prisma.numberPool.update({
      where: { id: poolEntryId },
      data: { status: 'ASSIGNED', assignedTo: workspaceId },
    }),
  ]);

  // Subscribe the app to this WABA so webhooks (Inbox, delivery receipts) flow.
  if (entry.encryptedAccessToken) {
    await ensureWabaSubscribed(number.id, wabaId, decrypt(entry.encryptedAccessToken));
  }

  // Fire-and-forget: sync templates from Meta for this number
  syncTemplatesFromMeta(workspaceId, number.id).catch(() => {});

  return { phoneNumber: number.phoneNumber, displayName: number.displayName, wabaId, appSubscribed: number.appSubscribed };
}

export async function disconnectNumber(workspaceId, numberId) {
  const waNumber = await prisma.waNumber.findFirst({ where: { id: numberId, workspaceId } });
  if (!waNumber) { const e = new Error('Number not found in this workspace'); e.status = 404; throw e; }

  // Templates live on the Meta WABA tied to the number. Once the last number is
  // gone, the workspace cannot operate on those templates anymore, so wipe them.
  // Campaigns belong to the user's history and stay.
  const remainingNumbers = await prisma.waNumber.count({
    where: { workspaceId, id: { not: waNumber.id } },
  });

  await prisma.$transaction([
    ...(remainingNumbers === 0 ? [prisma.template.deleteMany({ where: { workspaceId } })] : []),
    prisma.waNumber.delete({ where: { id: waNumber.id } }),
    prisma.numberPool.updateMany({
      where: { phoneNumberId: waNumber.metaPhoneNumberId, assignedTo: workspaceId },
      data: { status: 'AVAILABLE', assignedTo: null },
    }),
  ]);

  return { ok: true, phoneNumber: waNumber.phoneNumber };
}

export async function getDecryptedNumber(workspaceId, numberId) {
  const n = await prisma.waNumber.findFirst({ where: { id: numberId, workspaceId } });
  if (!n) return null;
  return { ...n, accessToken: decrypt(n.encryptedAccessToken) };
}

export async function sendPublicMessage(workspaceId, { to, template, type, body, waNumberId }) {
  // Find the WhatsApp number to send from
  const waNumber = await prisma.waNumber.findFirst({
    where: {
      workspaceId,
      ...(waNumberId ? { id: waNumberId } : {})
    }
  });

  if (!waNumber) {
    const e = new Error('No WhatsApp number found for this workspace');
    e.status = 404;
    throw e;
  }

  const accessToken = decrypt(waNumber.encryptedAccessToken);
  const { sendWhatsAppMessage, sendTextMessage } = await import('../lib/meta.js');

  if (type === 'template') {
    return sendWhatsAppMessage(waNumber.metaPhoneNumberId, accessToken, to, template);
  } else if (type === 'text') {
    return sendTextMessage(waNumber.metaPhoneNumberId, accessToken, to, body);
  } else {
    const e = new Error('Invalid message type. Supported: template, text');
    e.status = 400;
    throw e;
  }
}
