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

// ─── Platform-wide super-admin views (not workspace-scoped) ───────────────────

export async function getPlatformStats() {
  const [workspaces, users, campaigns, contacts, numbers, agg, openTickets] = await Promise.all([
    prisma.workspace.count(),
    prisma.user.count(),
    prisma.campaign.count(),
    prisma.contact.count(),
    prisma.waNumber.count(),
    prisma.campaign.aggregate({ _sum: { sent: true, delivered: true, read: true, failed: true } }),
    prisma.supportTicket.count({ where: { status: 'OPEN' } }),
  ]);
  const suspended = await prisma.workspace.count({ where: { suspended: true } });
  return {
    totals: {
      workspaces, users, campaigns, contacts, connectedNumbers: numbers,
      suspendedWorkspaces: suspended, openTickets,
      messagesSent: agg._sum.sent || 0,
      messagesDelivered: agg._sum.delivered || 0,
      messagesRead: agg._sum.read || 0,
      messagesFailed: agg._sum.failed || 0,
    },
  };
}

export async function listWorkspacesDetailed() {
  const workspaces = await prisma.workspace.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { members: true, campaigns: true, contacts: true, waNumbers: true } },
      members: {
        where: { role: 'ADMIN' },
        take: 1,
        include: { user: { select: { email: true, name: true } } },
      },
    },
  });
  return workspaces.map((w) => ({
    id: w.id, name: w.name, plan: w.plan, suspended: w.suspended, suspendedReason: w.suspendedReason,
    walletBalance: Number(w.walletBalance), createdAt: w.createdAt,
    owner: w.members[0]?.user || null,
    counts: w._count,
  }));
}

export async function setWorkspaceSuspended(workspaceId, suspended, reason = null) {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  if (!ws) { const e = new Error('Workspace not found'); e.status = 404; throw e; }
  return prisma.workspace.update({
    where: { id: workspaceId },
    data: { suspended: !!suspended, suspendedReason: suspended ? (reason || 'Suspended by administrator') : null },
    select: { id: true, name: true, suspended: true, suspendedReason: true },
  });
}

export async function listAllTickets(status) {
  return prisma.supportTicket.findMany({
    where: status ? { status } : {},
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: { workspace: { select: { name: true } } },
  });
}

export async function updateTicket(ticketId, { status, adminNote }) {
  const t = await prisma.supportTicket.findUnique({ where: { id: ticketId } });
  if (!t) { const e = new Error('Ticket not found'); e.status = 404; throw e; }
  const data = {};
  if (status && ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'].includes(status)) data.status = status;
  if (adminNote !== undefined) data.adminNote = adminNote;
  return prisma.supportTicket.update({ where: { id: ticketId }, data });
}

// ─── Plan management (super-admin billing config) ─────────────────────────────
// Prices, quotas/rate-limits and feature flags for every subscription plan.
// These are the values subscription.service.js reads to enforce quota, plan
// limits and overage billing, so validation here keeps those callers safe.

// Feature flags enforced elsewhere (requireFeature / hasFeature). Surfaced to
// the admin UI as known toggles; arbitrary extra flags are still accepted.
export const KNOWN_FEATURE_FLAGS = ['automation', 'workflows', 'aiOnboarding', 'integrations'];

const badRequest = (message) => { const e = new Error(message); e.status = 400; throw e; };

// A limit field: non-negative integer, or null = unlimited.
function normLimit(value, label) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) badRequest(`${label} must be a non-negative whole number, or blank for unlimited`);
  return n;
}

// A money field (price / overage rate): non-negative number.
function normMoney(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) badRequest(`${label} must be a non-negative number`);
  return n;
}

function normFeatures(value) {
  if (value === undefined) return undefined;
  if (value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) badRequest('features must be an object of flag → boolean');
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (v) out[k] = true; // store only enabled flags; a false flag is simply absent
  }
  return out;
}

// Builds the Prisma data object. On create every field has a sensible default;
// on update (partial=true) only the keys present in `body` are touched.
function buildPlanData(body, { partial } = {}) {
  const data = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);

  if (!partial || has('name')) {
    const name = String(body.name ?? '').trim();
    if (!name) badRequest('Plan name is required');
    data.name = name;
  }
  if (!partial || has('priceMonthly')) data.priceMonthly = normMoney(body.priceMonthly ?? 0, 'Monthly price');
  if (!partial || has('currency')) data.currency = String(body.currency || 'USD').trim().toUpperCase().slice(0, 8) || 'USD';
  if (!partial || has('overageRatePerMsg')) data.overageRatePerMsg = normMoney(body.overageRatePerMsg ?? 0, 'Overage rate per message');

  if (!partial || has('messageQuota')) {
    const q = Number(body.messageQuota ?? 0);
    if (!Number.isInteger(q) || q < -1) badRequest('Message quota must be a whole number (use -1 for unlimited)');
    data.messageQuota = q;
  }
  if (!partial || has('contactLimit')) data.contactLimit = normLimit(body.contactLimit, 'Contact limit');
  if (!partial || has('memberLimit')) data.memberLimit = normLimit(body.memberLimit, 'Member limit');
  if (!partial || has('campaignLimit')) data.campaignLimit = normLimit(body.campaignLimit, 'Campaign limit');
  if (!partial || has('apiKeyLimit')) data.apiKeyLimit = normLimit(body.apiKeyLimit, 'API key limit');

  if (has('features')) { const f = normFeatures(body.features); if (f !== undefined) data.features = f; }
  else if (!partial) data.features = {};

  if (has('isActive')) data.isActive = !!body.isActive;
  else if (!partial) data.isActive = true;

  return data;
}

// All plans (active and inactive) with how many workspaces are on each, so the
// admin can see the blast radius before editing/retiring a plan.
export async function listAllPlans() {
  const plans = await prisma.plan.findMany({
    orderBy: { priceMonthly: 'asc' },
    include: { _count: { select: { subscriptions: true } } },
  });
  return plans.map((p) => ({ ...p, subscriberCount: p._count.subscriptions }));
}

export async function createPlan(body = {}) {
  const key = String(body.key ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9_]{2,32}$/.test(key)) {
    badRequest('Plan key must be 2–32 characters: uppercase letters, numbers or underscores (e.g. STARTER)');
  }
  const existing = await prisma.plan.findUnique({ where: { key } });
  if (existing) { const e = new Error(`A plan with key "${key}" already exists`); e.status = 409; throw e; }

  const data = buildPlanData(body, { partial: false });
  return prisma.plan.create({ data: { key, ...data } });
}

export async function updatePlan(id, body = {}) {
  const plan = await prisma.plan.findUnique({ where: { id } });
  if (!plan) { const e = new Error('Plan not found'); e.status = 404; throw e; }
  // Key is the stable identifier the rest of the system (and Workspace.plan)
  // keys off — renaming it would orphan live subscriptions, so it's immutable.
  const data = buildPlanData(body, { partial: true });
  return prisma.plan.update({ where: { id }, data });
}

export async function deletePlan(id) {
  const plan = await prisma.plan.findUnique({
    where: { id },
    include: { _count: { select: { subscriptions: true, pendingFor: true } } },
  });
  if (!plan) { const e = new Error('Plan not found'); e.status = 404; throw e; }
  const inUse = plan._count.subscriptions + plan._count.pendingFor;
  if (inUse > 0) {
    // Don't break FK-linked subscriptions; deactivate instead so it's hidden
    // from checkout but existing subscribers keep working.
    const e = new Error(`This plan has ${inUse} active or pending subscription(s). Deactivate it instead of deleting.`);
    e.status = 409; throw e;
  }
  await prisma.plan.delete({ where: { id } });
  return { ok: true };
}
