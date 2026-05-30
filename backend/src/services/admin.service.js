import twilio from 'twilio';
import { parsePhoneNumber } from 'libphonenumber-js';
import { prisma } from '../lib/prisma.js';
import { encrypt } from '../lib/encryption.js';
import {
  getWabaPhoneNumbers,
  requestOtp,
  verifyOtp,
  systemClient,
  createOwnedWaba,
  addPhoneNumberToWaba,
  registerPhoneNumber,
  subscribeAppToWaba,
} from '../lib/meta.js';
import { provisioningQueue } from '../queues/provisioning.queue.js';
import { env } from '../config/env.js';

// ── Pool summary ──────────────────────────────────────────────
export async function getPoolSummary() {
  const total = await prisma.numberPool.count();
  if (total === 0) await syncPoolFromWaba().catch(() => {});

  const [finalTotal, available, assigned, banned] = await Promise.all([
    prisma.numberPool.count(),
    prisma.numberPool.count({ where: { status: 'AVAILABLE' } }),
    prisma.numberPool.count({ where: { status: 'ASSIGNED' } }),
    prisma.numberPool.count({ where: { status: 'BANNED' } }),
  ]);
  const pool = await prisma.numberPool.findMany({ orderBy: { createdAt: 'desc' } });

  // Enrich assignedTo with workspace name
  const wsIds = [...new Set(pool.map(e => e.assignedTo).filter(Boolean))];
  const workspaces = wsIds.length
    ? await prisma.workspace.findMany({ where: { id: { in: wsIds } }, select: { id: true, name: true } })
    : [];
  const wsMap = Object.fromEntries(workspaces.map(w => [w.id, w.name]));
  const enriched = pool.map(e => ({ ...e, assignedToName: e.assignedTo ? (wsMap[e.assignedTo] ?? e.assignedTo) : null }));

  return { summary: { total: finalTotal, available, assigned, banned }, pool: enriched };
}

// ── Manual add ───────────────────────────────────────────────
export async function addToPool({ phoneNumber, phoneNumberId, wabaId, accessToken, displayName }) {
  const encryptedAccessToken = encrypt(accessToken);
  return prisma.numberPool.create({
    data: { phoneNumber, phoneNumberId, wabaId, encryptedAccessToken, displayName, status: 'AVAILABLE' },
  });
}

// ── OTP request / verify ─────────────────────────────────────
export async function sendOtpRequest({ metaPhoneNumberId, method }) {
  return requestOtp(metaPhoneNumberId, method);
}

export async function verifyOtpAndAdd({ phoneNumber, metaPhoneNumberId, otp, displayName }) {
  await verifyOtp(metaPhoneNumberId, otp);
  const encryptedAccessToken = encrypt(env.META_SYSTEM_USER_TOKEN);
  return prisma.numberPool.create({
    data: {
      phoneNumber,
      phoneNumberId: metaPhoneNumberId,
      wabaId: env.META_WABA_ID,
      encryptedAccessToken,
      displayName,
      status: 'AVAILABLE',
      registeredAt: new Date(),
    },
  });
}

// ── Reset ALL assignments ─────────────────────────────────────
export async function resetAllAssignments() {
  await prisma.$transaction([
    prisma.waNumber.deleteMany({}),
    prisma.numberPool.updateMany({
      where: { status: 'ASSIGNED' },
      data: { status: 'AVAILABLE', assignedTo: null },
    }),
  ]);
  return { ok: true };
}

// ── Reset pool entry ─────────────────────────────────────────
export async function resetPoolEntry(id) {
  const entry = await prisma.numberPool.findUnique({ where: { id } });
  if (!entry) {
    const err = new Error('Pool entry not found');
    err.status = 404;
    throw err;
  }
  const [, updated] = await prisma.$transaction([
    prisma.waNumber.deleteMany({ where: { metaPhoneNumberId: entry.phoneNumberId } }),
    prisma.numberPool.update({
      where: { id },
      data: { status: 'AVAILABLE', assignedTo: null },
    }),
  ]);
  return updated;
}

// ── Ban pool entry ────────────────────────────────────────────
export async function banPoolEntry(id) {
  return prisma.numberPool.update({
    where: { id },
    data: { status: 'BANNED' },
  });
}

// ── Twilio provisioning (Option 1) ────────────────────────────
// Kicks off provisioning on a background queue and returns immediately — the
// per-number pipeline polls for OTPs and can take minutes. The admin UI polls
// the pool to see numbers appear.
export async function twilioSync() {
  const job = await provisioningQueue.add('twilio-sync', { type: 'twilio-sync' });
  return {
    queued: true,
    jobId: job.id,
    message: 'Provisioning started in the background. Numbers will appear in the pool as they finish registering.',
  };
}

// The actual pipeline (runs in the provisioning worker). For every Twilio number
// not already pooled: create a dedicated sub-WABA under the main business, add the
// number to it, verify ownership via the OTP that Twilio receives, register the
// number for Cloud API, subscribe our app for webhooks, and pool it.
export async function provisionTwilioNumbers() {
  const client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
  const twilioNumbers = await client.incomingPhoneNumbers.list();
  const results = [];

  for (const tn of twilioNumbers) {
    const phoneNumber = tn.phoneNumber; // E.164, e.g. +15559396638
    const existing = await prisma.numberPool.findFirst({ where: { phoneNumber } });
    if (existing) {
      results.push({ phoneNumber, status: 'skipped', reason: 'already in pool' });
      continue;
    }

    try {
      const parsed = parsePhoneNumber(phoneNumber);
      if (!parsed) {
        results.push({ phoneNumber, status: 'failed', reason: 'could not parse phone number' });
        continue;
      }
      const cc = parsed.countryCallingCode;   // e.g. "1"
      const national = parsed.nationalNumber;  // e.g. "5559396638"
      const displayName = tn.friendlyName || env.META_DISPLAY_NAME || 'Business';

      // 1. Create a dedicated sub-WABA under the main business
      const waba = await createOwnedWaba(`CFP ${phoneNumber}`);
      const wabaId = waba.id;

      // 2. Add the number to that sub-WABA
      const pn = await addPhoneNumberToWaba(wabaId, { cc, phoneNumber: national, verifiedName: displayName });
      const phoneNumberId = pn.id;

      // 3. Request the verification code via SMS (Twilio receives it)
      await requestOtp(phoneNumberId, 'SMS');

      // 4. Poll the Twilio inbox for the OTP (up to 120s)
      const otp = await pollTwilioForOtp(client, phoneNumber, 120);
      if (!otp) {
        results.push({ phoneNumber, status: 'failed', reason: 'OTP not received within 120s', wabaId });
        continue;
      }

      // 5. Verify ownership
      await verifyOtp(phoneNumberId, otp);

      // 6. Register for Cloud API
      await registerPhoneNumber(phoneNumberId, env.META_TWO_STEP_PIN);

      // 7. Subscribe our app to the new WABA's webhooks
      await subscribeAppToWaba(wabaId);

      // 8. Pool it
      await prisma.numberPool.create({
        data: {
          phoneNumber,
          phoneNumberId,
          wabaId,
          encryptedAccessToken: encrypt(env.META_SYSTEM_USER_TOKEN),
          displayName,
          status: 'AVAILABLE',
          registeredAt: new Date(),
        },
      });

      results.push({ phoneNumber, status: 'added', wabaId, phoneNumberId });
    } catch (err) {
      const reason = err.response?.data?.error?.message || err.message;
      results.push({ phoneNumber, status: 'failed', reason });
    }
  }

  return { provisioned: results.filter(r => r.status === 'added').length, results };
}

async function pollTwilioForOtp(client, to, timeoutSec) {
  const start = Date.now();
  const sinceDate = new Date(start - 5000);

  while ((Date.now() - start) / 1000 < timeoutSec) {
    const messages = await client.messages.list({ to, dateSentAfter: sinceDate, limit: 5 });
    for (const msg of messages) {
      const match = msg.body.match(/\b(\d{6})\b/);
      if (match) return match[1];
    }
    await new Promise(r => setTimeout(r, 5000));
  }
  return null;
}

// ── Sync pool from Meta WABA (no OTP needed — uses system token) ──
export async function syncPoolFromWaba() {
  const metaNumbers = await getWabaPhoneNumbers(env.META_WABA_ID);
  const added = [];
  const skipped = [];

  for (const num of metaNumbers) {
    const existing = await prisma.numberPool.findFirst({
      where: { phoneNumberId: num.id },
    });
    if (existing) {
      skipped.push(num.display_phone_number);
      continue;
    }
    await prisma.numberPool.create({
      data: {
        phoneNumber:          num.display_phone_number,
        phoneNumberId:        num.id,
        wabaId:               env.META_WABA_ID,
        encryptedAccessToken: encrypt(env.META_SYSTEM_USER_TOKEN),
        displayName:          num.verified_name ?? null,
        status:               'AVAILABLE',
        registeredAt:         new Date(),
      },
    });
    added.push(num.display_phone_number);
  }

  const summary = await getPoolSummary();
  return { added, skipped, summary };
}

// ── Admin: list workspaces (for assignment picker) ───────────
export async function listWorkspaces() {
  const workspaces = await prisma.workspace.findMany({
    select: {
      id: true,
      name: true,
      members: {
        select: { user: { select: { id: true, name: true, email: true } } },
        orderBy: { joinedAt: 'asc' },
        take: 1,
      },
    },
    orderBy: { createdAt: 'desc' },
  });
  return workspaces.map((w) => ({
    id: w.id,
    name: w.name,
    owner: w.members[0]?.user ?? null,
  }));
}

// ── Admin: assign a pool entry directly to a workspace ───────
export async function assignToWorkspace(poolEntryId, workspaceId) {
  const entry = await prisma.numberPool.findUnique({ where: { id: poolEntryId } });
  if (!entry) { const e = new Error('Pool entry not found'); e.status = 404; throw e; }
  if (entry.status !== 'AVAILABLE') {
    const e = new Error(`Pool entry is ${entry.status}, not AVAILABLE`); e.status = 400; throw e;
  }

  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  if (!workspace) { const e = new Error('Workspace not found'); e.status = 404; throw e; }

  const existing = await prisma.waNumber.findFirst({
    where: { workspaceId, metaPhoneNumberId: entry.phoneNumberId },
  });
  if (existing) {
    const e = new Error('Number already connected to this workspace'); e.status = 409; throw e;
  }

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
      data:  { status: 'ASSIGNED', assignedTo: workspaceId },
    }),
  ]);

  return { ok: true, number: { id: number.id, phoneNumber: number.phoneNumber }, workspace: { id: workspace.id, name: workspace.name } };
}

// ── WABA numbers ──────────────────────────────────────────────
export async function getWabaNumbers() {
  const numbers = await getWabaPhoneNumbers(env.META_WABA_ID);
  return { numbers };
}

// ── Meta test calls (app review) ──────────────────────────────
export async function metaTestCalls() {
  const results = [];

  // 1. List phone numbers
  try {
    const nums = await getWabaPhoneNumbers(env.META_WABA_ID);
    results.push({ endpoint: `GET /${env.META_WABA_ID}/phone_numbers`, status: 'ok', count: nums.length });
  } catch (err) {
    results.push({ endpoint: `GET /${env.META_WABA_ID}/phone_numbers`, status: 'error', error: err.message });
  }

  // 2. List message templates
  try {
    const { data } = await systemClient.get(`/${env.META_WABA_ID}/message_templates`, {
      params: { fields: 'id,name,status,category', limit: 10 },
    });
    results.push({ endpoint: `GET /${env.META_WABA_ID}/message_templates`, status: 'ok', count: data.data?.length ?? 0 });
  } catch (err) {
    results.push({ endpoint: `GET /${env.META_WABA_ID}/message_templates`, status: 'error', error: err.message });
  }

  // 3. Get WABA info
  try {
    const { data } = await systemClient.get(`/${env.META_WABA_ID}`, {
      params: { fields: 'id,name,currency,timezone_id' },
    });
    results.push({ endpoint: `GET /${env.META_WABA_ID}`, status: 'ok', data });
  } catch (err) {
    results.push({ endpoint: `GET /${env.META_WABA_ID}`, status: 'error', error: err.message });
  }

  return { results, allPassed: results.every(r => r.status === 'ok') };
}
