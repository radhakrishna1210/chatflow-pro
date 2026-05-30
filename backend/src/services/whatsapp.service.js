import { parsePhoneNumber } from 'libphonenumber-js';
import { prisma } from '../lib/prisma.js';
import { encrypt, decrypt } from '../lib/encryption.js';
import {
  getWabaPhoneNumbers,
  addPhoneNumberToWaba,
  requestOtp,
  verifyOtp,
  exchangeCodeForToken,
  subscribeAppToWaba,
  registerPhoneNumber,
  getPhoneNumberById,
} from '../lib/meta.js';
import { syncTemplatesFromMeta } from './templates.service.js';
import { env } from '../config/env.js';

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
  const encryptedAccessToken = encrypt(accessToken);
  const number = await prisma.waNumber.create({
    data: { workspaceId, phoneNumber, metaPhoneNumberId, wabaId, encryptedAccessToken, displayName },
  });
  return { ...number, encryptedAccessToken: undefined };
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

  // The pool entry already has its own dedicated sub-WABA (created + registered +
  // webhook-subscribed at provisioning time), so claiming is just an assignment.
  const [number] = await prisma.$transaction([
    prisma.waNumber.create({
      data: {
        workspaceId,
        phoneNumber:          entry.phoneNumber,
        metaPhoneNumberId:    entry.phoneNumberId,
        wabaId:               entry.wabaId,
        encryptedAccessToken: entry.encryptedAccessToken,
        displayName:          entry.displayName,
      },
    }),
    prisma.numberPool.update({
      where: { id: poolEntryId },
      data: { status: 'ASSIGNED', assignedTo: workspaceId },
    }),
  ]);

  // Fire-and-forget: sync templates from Meta for this workspace
  syncTemplatesFromMeta(workspaceId).catch(() => {});

  return { phoneNumber: number.phoneNumber, displayName: number.displayName, wabaId: entry.wabaId };
}

export async function disconnectNumber(workspaceId, numberId) {
  const waNumber = await prisma.waNumber.findFirst({ where: { id: numberId, workspaceId } });
  if (!waNumber) { const e = new Error('Number not found in this workspace'); e.status = 404; throw e; }

  // Template rows are kept (campaigns FK to them as history). They are already
  // hidden from listTemplates when no WaNumber exists in the workspace.
  await prisma.$transaction([
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

// ── Embedded Signup (customer connects via Meta) ──────────────

export function getEmbeddedSignupConfig() {
  return {
    appId:        env.META_APP_ID,
    configId:     env.META_ES_CONFIG_ID || null,
    graphVersion: env.META_API_VERSION,
  };
}

// Completes Embedded Signup: the popup already created/selected the customer's WABA and
// number under THEIR business; here we exchange the code for a token, subscribe our app to
// their WABA for webhooks, ensure the number is registered, and store it in the workspace.
export async function completeEmbeddedSignup(workspaceId, { code, wabaId, phoneNumberId }) {
  if (!code)          { const e = new Error('Missing authorization code'); e.status = 400; throw e; }
  if (!wabaId)        { const e = new Error('Missing wabaId from signup session'); e.status = 400; throw e; }
  if (!phoneNumberId) { const e = new Error('Missing phoneNumberId from signup session'); e.status = 400; throw e; }

  // 1. Exchange the code for a (long-lived) business access token scoped to the customer's WABA.
  const tokenData = await exchangeCodeForToken(code);
  const accessToken = tokenData.access_token;
  if (!accessToken) { const e = new Error('Token exchange returned no access_token'); e.status = 502; throw e; }

  // 2. Subscribe our app to the customer's WABA so inbound messages/statuses reach our webhook.
  try {
    await subscribeAppToWaba(wabaId, accessToken);
  } catch (err) {
    console.error('[ES] subscribed_apps failed (will need retry):', err.response?.data?.error?.message || err.message);
  }

  // 3. Ensure the number is registered for Cloud API (tolerate already-registered).
  try {
    await registerPhoneNumber(phoneNumberId, env.META_TWO_STEP_PIN, accessToken);
  } catch (err) {
    console.warn('[ES] register skipped/failed (often already registered):', err.response?.data?.error?.message || err.message);
  }

  // 4. Fetch the number's details for display.
  let details = {};
  try {
    details = await getPhoneNumberById(phoneNumberId, accessToken);
  } catch (err) {
    console.warn('[ES] could not fetch phone number details:', err.response?.data?.error?.message || err.message);
  }

  const encryptedAccessToken = encrypt(accessToken);
  const data = {
    workspaceId,
    phoneNumber:       details.display_phone_number || '',
    metaPhoneNumberId: phoneNumberId,
    wabaId,
    encryptedAccessToken,
    displayName:       details.verified_name || null,
    quality:           details.quality_rating || null,
  };

  // 5. Upsert the WaNumber (idempotent if the customer reconnects the same number).
  const existing = await prisma.waNumber.findFirst({ where: { workspaceId, metaPhoneNumberId: phoneNumberId } });
  const number = existing
    ? await prisma.waNumber.update({ where: { id: existing.id }, data })
    : await prisma.waNumber.create({ data });

  // 6. Fire-and-forget: pull the customer's approved templates.
  syncTemplatesFromMeta(workspaceId).catch(() => {});

  return { id: number.id, phoneNumber: number.phoneNumber, displayName: number.displayName, wabaId };
}

// ── BYO via OTP (customer's own number → our main WABA) ──────────

export async function byoRequestOtp(workspaceId, { phoneNumber, displayName }) {
  let parsed;
  try { parsed = parsePhoneNumber(phoneNumber); } catch {
    const e = new Error('Invalid phone number — use E.164 format e.g. +91 98765 43210'); e.status = 400; throw e;
  }
  if (!parsed.isValid()) {
    const e = new Error('Phone number is not valid'); e.status = 400; throw e;
  }

  const added = await addPhoneNumberToWaba(env.META_WABA_ID, {
    cc: parsed.countryCallingCode,
    phoneNumber: parsed.nationalNumber,
    verifiedName: displayName || 'Business',
  });

  await requestOtp(added.id, 'SMS');

  return { phoneNumberId: added.id, message: 'OTP sent via SMS' };
}

export async function byoVerifyOtp(workspaceId, { phoneNumberId, code, phoneNumber, displayName }) {
  if (!phoneNumberId) { const e = new Error('Missing phoneNumberId'); e.status = 400; throw e; }
  if (!code)          { const e = new Error('Missing OTP code');      e.status = 400; throw e; }

  await verifyOtp(phoneNumberId, code);

  try { await registerPhoneNumber(phoneNumberId, env.META_TWO_STEP_PIN); }
  catch (err) { console.warn('[BYO] register skipped:', err.response?.data?.error?.message || err.message); }

  try { await subscribeAppToWaba(env.META_WABA_ID); }
  catch (err) { console.warn('[BYO] subscribed_apps:', err.response?.data?.error?.message || err.message); }

  let details = {};
  try { details = await getPhoneNumberById(phoneNumberId); } catch {}

  const encryptedAccessToken = encrypt(env.META_SYSTEM_USER_TOKEN);
  const data = {
    workspaceId,
    phoneNumber:       details.display_phone_number || phoneNumber || '',
    metaPhoneNumberId: phoneNumberId,
    wabaId:            env.META_WABA_ID,
    encryptedAccessToken,
    displayName:       details.verified_name || displayName || null,
    quality:           details.quality_rating || null,
  };

  const existing = await prisma.waNumber.findFirst({ where: { workspaceId, metaPhoneNumberId: phoneNumberId } });
  const number = existing
    ? await prisma.waNumber.update({ where: { id: existing.id }, data })
    : await prisma.waNumber.create({ data });

  syncTemplatesFromMeta(workspaceId).catch(() => {});

  return { id: number.id, phoneNumber: number.phoneNumber, displayName: number.displayName, wabaId: env.META_WABA_ID };
}
