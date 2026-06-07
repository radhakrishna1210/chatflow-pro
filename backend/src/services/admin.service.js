import twilio from 'twilio';
import { prisma } from '../lib/prisma.js';
import { encrypt } from '../lib/encryption.js';
import {
  getWabaPhoneNumbers,
  requestOtp,
  verifyOtp,
  systemClient,
} from '../lib/meta.js';
import { provisioningQueue } from '../queues/provisioning.queue.js';
import { env } from '../config/env.js';

// ── Pool summary ──────────────────────────────────────────────
export async function getPoolSummary() {
  const total = await prisma.numberPool.count();
  if (total === 0) await syncPoolFromWaba().catch(() => {});

  const [finalTotal, available, assigned, banned, provisioning] = await Promise.all([
    prisma.numberPool.count(),
    prisma.numberPool.count({ where: { status: 'AVAILABLE' } }),
    prisma.numberPool.count({ where: { status: 'ASSIGNED' } }),
    prisma.numberPool.count({ where: { status: 'BANNED' } }),
    prisma.numberPool.count({ where: { status: 'PROVISIONING' } }),
  ]);
  const pool = await prisma.numberPool.findMany({ orderBy: { createdAt: 'desc' } });

  // Enrich assignedTo with workspace name
  const wsIds = [...new Set(pool.map(e => e.assignedTo).filter(Boolean))];
  const workspaces = wsIds.length
    ? await prisma.workspace.findMany({ where: { id: { in: wsIds } }, select: { id: true, name: true } })
    : [];
  const wsMap = Object.fromEntries(workspaces.map(w => [w.id, w.name]));
  const enriched = pool.map(e => ({ ...e, assignedToName: e.assignedTo ? (wsMap[e.assignedTo] ?? e.assignedTo) : null }));

  return { summary: { total: finalTotal, available, assigned, banned, provisioning }, pool: enriched };
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

// ── Twilio provisioning (Option 1: platform-owned pooled numbers) ──
// NOTE: we cannot auto-create a WABA from Meta's side — POST
// /{business_id}/owned_whatsapp_business_accounts is rejected ("does not support
// this operation"). So this step only pulls the numbers off the Twilio account
// into the pool; turning each into a live WhatsApp sender is a separate step
// (Twilio WhatsApp Senders API) handled after a number is in PROVISIONING.
//
// Validates Twilio is configured, then runs the sync on the provisioning queue
// (kept off the request thread so it can grow into the sender-registration step
// later). The admin UI polls the pool to see numbers appear.
export async function twilioSync() {
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) {
    const e = new Error('Twilio is not configured — set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.');
    e.status = 400;
    throw e;
  }
  const job = await provisioningQueue.add('twilio-sync', { type: 'twilio-sync' });
  return {
    queued: true,
    jobId: job.id,
    message: 'Syncing numbers from Twilio — they will appear in the pool shortly (status: Provisioning).',
  };
}

// Runs in the provisioning worker. Lists the phone numbers on the configured
// Twilio account and adds any not already pooled. Each lands as provider 'TWILIO',
// status 'PROVISIONING' — it has no Meta phone-number id / WABA yet, so it is NOT a
// live WhatsApp sender and stays unassignable until activated.
export async function provisionTwilioNumbers() {
  const client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
  const twilioNumbers = await client.incomingPhoneNumbers.list({ limit: 200 });

  const added = [];
  const skipped = [];

  for (const tn of twilioNumbers) {
    const phoneNumber = tn.phoneNumber; // E.164, e.g. +15559396638
    const existing = await prisma.numberPool.findUnique({ where: { phoneNumber } });
    if (existing) { skipped.push(phoneNumber); continue; }

    await prisma.numberPool.create({
      data: {
        phoneNumber,
        provider:    'TWILIO',
        twilioSid:   tn.sid,
        displayName: tn.friendlyName || null,
        status:      'PROVISIONING',
      },
    });
    added.push(phoneNumber);
  }

  return { provider: 'twilio', added, skipped };
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
