import { prisma } from '../lib/prisma.js';
import { encrypt, decrypt } from '../lib/encryption.js';
import {
  getWabaPhoneNumbers, systemClient, subscribeAppToWaba, getSubscribedApps,
  exchangeEmbeddedSignupCode, getLongLivedToken, registerPhoneNumber, getPhoneNumberById,
  getPhoneNumberStatus, requestOtp, verifyOtp,
} from '../lib/meta.js';
import { syncTemplatesFromMeta } from './templates.service.js';
import { assertNotOptedOut, normalizePhone as normalizeMsisdn } from './optout.service.js';
import { env } from '../config/env.js';
import { markNumberUnreachable } from './outbound.service.js';

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

// Re-reads each of this workspace's numbers from Meta, using the number's own
// access token.
//
// It previously enumerated the *platform's* WABA and updated only numbers that
// happened to appear there, so a customer's own WABA (which is what Embedded
// Signup creates) was never refreshed at all. It also never recorded
// verification state, and a number Meta no longer recognises simply stayed
// "ACTIVE" forever — two such numbers exist in the live database today.
async function refreshExistingFromMeta(workspaceId) {
  const numbers = await prisma.waNumber.findMany({ where: { workspaceId } });

  await Promise.all(numbers.map(async (n) => {
    try {
      const details = await getPhoneNumberStatus(n.metaPhoneNumberId, decrypt(n.encryptedAccessToken));
      await prisma.waNumber.update({
        where: { id: n.id },
        data: {
          phoneNumber: details.display_phone_number ?? n.phoneNumber,
          displayName: details.verified_name ?? n.displayName,
          quality: details.quality_rating ?? n.quality,
          status: details.status ?? n.status,
          codeVerificationStatus: details.code_verification_status ?? n.codeVerificationStatus,
          ...(details.code_verification_status === 'VERIFIED' ? { lastVerifiedAt: new Date() } : {}),
          // Answering at all clears a previous unreachable mark.
          unreachableSince: null,
          unreachableReason: null,
        },
      });
    } catch (err) {
      const meta = err.response?.data?.error;
      const gone = Number(meta?.code) === 100 || Number(meta?.code) === 190;
      console.error(`[whatsapp] Could not refresh ${n.phoneNumber}:`, meta?.message || err.message);
      if (gone) {
        await markNumberUnreachable(n.id, meta).catch(() => {});
      }
    }
  }));
}

// ─── Number verification (the customer's own numbers) ────────────────────────
//
// Verification existed only in the super-admin number-pool flow, and it
// authenticated as the platform's system user. A customer who connected their
// own number through Embedded Signup therefore had no way to request a code at
// all — which is exactly the reported "after adding a number, no OTP arrives".
// These use the number's own stored token, so they work for both.

export async function requestNumberVerification(workspaceId, numberId, method = 'SMS') {
  const n = await prisma.waNumber.findFirst({ where: { id: numberId, workspaceId } });
  if (!n) { const e = new Error('Number not found in this workspace'); e.status = 404; throw e; }

  const codeMethod = String(method).toUpperCase() === 'VOICE' ? 'VOICE' : 'SMS';
  try {
    await requestOtp(n.metaPhoneNumberId, codeMethod, decrypt(n.encryptedAccessToken));
  } catch (err) {
    throw describeVerificationError(err, codeMethod);
  }
  return {
    ok: true,
    method: codeMethod,
    message: `WhatsApp is sending a 6-digit code to ${n.phoneNumber} by ${codeMethod === 'VOICE' ? 'phone call' : 'SMS'}. It can take a minute to arrive.`,
  };
}

export async function confirmNumberVerification(workspaceId, numberId, code) {
  const n = await prisma.waNumber.findFirst({ where: { id: numberId, workspaceId } });
  if (!n) { const e = new Error('Number not found in this workspace'); e.status = 404; throw e; }

  const digits = String(code || '').replace(/\D/g, '');
  if (digits.length !== 6) {
    const e = new Error('Enter the 6-digit code exactly as WhatsApp sent it.'); e.status = 400; throw e;
  }

  const accessToken = decrypt(n.encryptedAccessToken);
  try {
    await verifyOtp(n.metaPhoneNumberId, digits, accessToken);
  } catch (err) {
    throw describeVerificationError(err);
  }

  // Read the state back rather than assuming success flipped it — Meta is the
  // authority on whether the number counts as verified.
  const details = await getPhoneNumberStatus(n.metaPhoneNumberId, accessToken).catch(() => ({}));
  const updated = await prisma.waNumber.update({
    where: { id: n.id },
    data: {
      codeVerificationStatus: details.code_verification_status ?? 'VERIFIED',
      lastVerifiedAt: new Date(),
      status: details.status ?? n.status,
      unreachableSince: null,
      unreachableReason: null,
    },
  });

  // A freshly verified number still has to be registered on Cloud API before it
  // can send. Non-fatal: an already-registered number reports so and is fine.
  await registerPhoneNumber(n.metaPhoneNumberId, accessToken).catch((err) => {
    console.warn('[whatsapp] registerPhoneNumber after verification:', err.response?.data?.error?.message || err.message);
  });

  const { encryptedAccessToken: _o, ...safe } = updated;
  return { ok: true, number: safe };
}

// Meta's verification errors are the ones users hit most, and its raw text does
// not say what to do about any of them.
function describeVerificationError(err, method) {
  const meta = err.response?.data?.error;
  const code = Number(meta?.code);
  const raw = meta ? `${meta.message} (code ${meta.code})` : err.message;
  const map = {
    136024: 'WhatsApp is rate limiting verification for this number. Wait a few minutes before requesting another code.',
    136025: 'That code was not accepted. Request a new one and try again.',
    100: 'WhatsApp does not recognise this phone number ID, or the stored access token has lost permission for it. Reconnect the number.',
    190: 'The access token for this number has expired. Reconnect the number, then verify it.',
    133005: 'This number is already verified and registered.',
  };
  const e = new Error(
    map[code]
      ? `${map[code]} (${raw})`
      : `WhatsApp could not ${method ? 'send the verification code' : 'verify that code'}: ${raw}`,
  );
  e.status = code === 133005 ? 409 : 400;
  e.expose = true;
  return e;
}

// Today's send count per number, keyed by waNumberId.
//
// Meta's messaging limit is a daily allowance, so "10K limit" only means
// something next to how much of today is already spent. Counted from campaign
// recipients rather than a running column: a counter would drift on retries and
// could not be recomputed after the fact.
async function sentTodayByNumber(workspaceId) {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const rows = await prisma.campaignRecipient.groupBy({
    by: ['campaignId'],
    where: { sentAt: { gte: startOfDay }, campaign: { workspaceId } },
    _count: { _all: true },
  });
  if (rows.length === 0) return {};

  const campaigns = await prisma.campaign.findMany({
    where: { id: { in: rows.map((r) => r.campaignId) } },
    select: { id: true, waNumberId: true },
  });
  const numberOf = Object.fromEntries(campaigns.map((c) => [c.id, c.waNumberId]));

  const totals = {};
  for (const row of rows) {
    const numberId = numberOf[row.campaignId];
    if (!numberId) continue;
    totals[numberId] = (totals[numberId] || 0) + row._count._all;
  }
  return totals;
}

export async function listNumbers(workspaceId) {
  const [numbers, sentToday] = await Promise.all([
    prisma.waNumber.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { campaigns: true, conversations: true, templates: true } } },
    }),
    sentTodayByNumber(workspaceId),
  ]);
  return numbers.map(({ encryptedAccessToken: _, _count, ...n }) => ({
    ...n,
    sentToday: sentToday[n.id] || 0,
    campaigns: _count.campaigns,
    conversations: _count.conversations,
    templates: _count.templates,
  }));
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

  // Nothing verified any of this before, so whatever was typed into the form
  // was saved as a working number. The live database ended up holding rows with
  // ids like "PN123" and "test_pnid" — connected in the UI, guaranteed to fail
  // on the first send, with no indication of why. Asking Meta first turns a
  // typo into an error at the point it can still be corrected.
  let details;
  try {
    details = await getPhoneNumberStatus(metaPhoneNumberId, accessToken);
  } catch (err) {
    const meta = err.response?.data?.error;
    const e = new Error(
      meta
        ? `WhatsApp rejected these details: ${meta.message} (code ${meta.code}). Check the phone number ID and that the access token has permission for it.`
        : `Could not reach WhatsApp to verify these details: ${err.message}`,
    );
    e.status = 400;
    e.expose = true;
    throw e;
  }

  const existing = await prisma.waNumber.findFirst({ where: { workspaceId, metaPhoneNumberId } });
  if (existing) {
    const e = new Error('That WhatsApp number is already connected to this workspace.');
    e.status = 409;
    throw e;
  }

  const encryptedAccessToken = encrypt(accessToken);
  const number = await prisma.waNumber.create({
    data: {
      workspaceId,
      // Prefer what Meta says the number is over what was typed.
      phoneNumber: details.display_phone_number || phoneNumber,
      metaPhoneNumberId,
      wabaId,
      encryptedAccessToken,
      displayName: details.verified_name || displayName || null,
      status: details.status || 'ACTIVE',
      quality: details.quality_rating || null,
      codeVerificationStatus: details.code_verification_status || null,
      lastVerifiedAt: details.code_verification_status === 'VERIFIED' ? new Date() : null,
    },
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

// Deletes WaNumber rows together with the data that would otherwise block the
// delete, and runs `extraOps` in the same transaction.
//
// Templates live on the Meta WABA tied to the number, so they cascade away with
// it — except the ones a campaign points at: that FK is restrict, and campaign
// history must stay intact. Those are detached from the number and tombstoned as
// DELETED, which keeps them out of every template list. Conversations detach via
// their SetNull FK so the inbox history survives.
export async function deleteWaNumbers(waNumberIds, extraOps = []) {
  const ids = [...new Set(waNumberIds)];

  const templates = ids.length
    ? await prisma.template.findMany({
        where: { waNumberId: { in: ids } },
        select: { id: true, _count: { select: { campaigns: true } } },
      })
    : [];
  const tombstone = templates.filter((t) => t._count.campaigns > 0).map((t) => t.id);

  return prisma.$transaction([
    ...(tombstone.length
      ? [prisma.template.updateMany({
          where: { id: { in: tombstone } },
          data: { waNumberId: null, status: 'DELETED' },
        })]
      : []),
    ...(ids.length ? [prisma.waNumber.deleteMany({ where: { id: { in: ids } } })] : []),
    ...extraOps,
  ]);
}

export async function disconnectNumber(workspaceId, numberId) {
  const waNumber = await prisma.waNumber.findFirst({ where: { id: numberId, workspaceId } });
  if (!waNumber) { const e = new Error('Number not found in this workspace'); e.status = 404; throw e; }

  await deleteWaNumbers([waNumber.id], [
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
  if (!to || !String(to).trim()) {
    const e = new Error('`to` (recipient phone number) is required'); e.status = 400; throw e;
  }
  // Meta rejects anything but bare digits — a caller passing "+91 98765 43210"
  // used to get an opaque 400 back from the Graph API.
  const recipient = normalizeMsisdn(to);
  if (recipient.length < 8) {
    const e = new Error('`to` must be a phone number in international format, e.g. +919876543210');
    e.status = 400;
    throw e;
  }

  // Opt-out is enforced before anything is sent, on every send path.
  await assertNotOptedOut(workspaceId, recipient);

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
    return sendWhatsAppMessage(waNumber.metaPhoneNumberId, accessToken, recipient, template);
  } else if (type === 'text') {
    return sendTextMessage(waNumber.metaPhoneNumberId, accessToken, recipient, body);
  } else {
    const e = new Error('Invalid message type. Supported: template, text');
    e.status = 400;
    throw e;
  }
}
