import twilio from 'twilio';
import { prisma } from '../lib/prisma.js';
import { encrypt } from '../lib/encryption.js';
import { getWabaPhoneNumbers, requestOtp, verifyOtp, systemClient } from '../lib/meta.js';
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

// ── Twilio auto-sync ──────────────────────────────────────────
export async function twilioSync() {
  const client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
  const twilioNumbers = await client.incomingPhoneNumbers.list();
  const results = [];

  for (const tn of twilioNumbers) {
    const phoneNumber = tn.phoneNumber;
    const existing = await prisma.numberPool.findFirst({ where: { phoneNumber } });
    if (existing) {
      results.push({ phoneNumber, status: 'skipped', reason: 'already in pool' });
      continue;
    }

    try {
      // 1. Request OTP from Meta (SMS to Twilio number)
      const metaNum = await getMetaPhoneNumberByPhone(phoneNumber);
      if (!metaNum) {
        results.push({ phoneNumber, status: 'skipped', reason: 'not registered in Meta WABA' });
        continue;
      }

      await requestOtp(metaNum.id, 'SMS');

      // 2. Poll Twilio inbox for OTP (up to 120s)
      const otp = await pollTwilioForOtp(client, phoneNumber, 120);
      if (!otp) {
        results.push({ phoneNumber, status: 'failed', reason: 'OTP not received within 120s' });
        continue;
      }

      // 3. Verify with Meta
      await verifyOtp(metaNum.id, otp);

      // 4. Save to pool
      const encryptedAccessToken = encrypt(env.META_SYSTEM_USER_TOKEN);
      await prisma.numberPool.create({
        data: {
          phoneNumber,
          phoneNumberId: metaNum.id,
          wabaId: env.META_WABA_ID,
          encryptedAccessToken,
          displayName: metaNum.verified_name ?? tn.friendlyName ?? '',
          status: 'AVAILABLE',
          registeredAt: new Date(),
        },
      });

      results.push({ phoneNumber, status: 'added' });
    } catch (err) {
      results.push({ phoneNumber, status: 'failed', reason: err.message });
    }
  }

  return { synced: results.filter(r => r.status === 'added').length, results };
}

async function getMetaPhoneNumberByPhone(phoneNumber) {
  try {
    const nums = await getWabaPhoneNumbers(env.META_WABA_ID);
    // Meta returns numbers in E.164 without spaces; normalise for comparison
    const normalise = p => p.replace(/\s+/g, '').replace(/[^+\d]/g, '');
    return nums.find(n => normalise(n.display_phone_number) === normalise(phoneNumber)) ?? null;
  } catch {
    return null;
  }
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
