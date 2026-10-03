import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import { getRazorpayClient, verifyPaymentSignature, normalizeRazorpayError } from '../lib/razorpay.js';
import { ADDONS, CURRENCY, getAddon, priceInPaise, assertPurchasable } from '../lib/addonCatalogue.js';
import { applyGatewayPaymentOnce } from './gatewayPayment.service.js';
import { debit } from './wallet.service.js';
import { notifyWorkspace, notifyWorkspaceGrouped } from './notification.service.js';

// Add-on purchase, server-authoritative end to end.
//
// The amount is never taken from the request. It is read from the catalogue
// when the order is created, stored in the order's notes, and read back *from
// Razorpay* at verification time — so the figure the wallet is charged is the
// figure the catalogue quoted, and a tampered client cannot change it. This
// mirrors what wallet.service.js already does for top-ups.

// An add-on is sold as 30-day packs, one WorkspaceAddon row per pack. Packs of
// the same add-on stack: buying the field pack twice gives ten fields, each
// pack until its own period ends. A pack with auto-renew on is renewed from
// the wallet by runAddonRenewalSweep() (daily billing job); without it, or
// without the balance, it expires and the workspace is told.
const PERIOD_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const PERIOD_MS = PERIOD_DAYS * DAY_MS;
// The sweep runs once a day, so a pack is renewed up to a day before it ends
// rather than lapsing for most of a day first. The new period still starts
// where the old one ends, so renewing early costs the customer nothing.
export const RENEW_AHEAD_MS = 26 * 60 * 60 * 1000;

// Statuses that still grant the add-on until currentPeriodEnd.
const LIVE = ['ACTIVE', 'CANCELLED'];

const formatMoney = (value) => `₹${Number(value || 0).toLocaleString('en-IN', {
  minimumFractionDigits: 0, maximumFractionDigits: 2,
})}`;

const livePacksWhere = (workspaceId, addonKey, now = new Date()) => ({
  workspaceId, addonKey, status: { in: LIVE }, currentPeriodEnd: { gt: now },
});

export async function listAddons(workspaceId) {
  const now = new Date();
  const owned = await prisma.workspaceAddon.findMany({
    where: { workspaceId, status: { in: LIVE }, currentPeriodEnd: { gt: now } },
    orderBy: { currentPeriodEnd: 'asc' },
  });
  const byKey = new Map();
  for (const row of owned) {
    if (!byKey.has(row.addonKey)) byKey.set(row.addonKey, []);
    byKey.get(row.addonKey).push(row);
  }

  return {
    currency: CURRENCY,
    addons: ADDONS.map((a) => {
      const packs = byKey.get(a.key) ?? [];
      const renewing = packs.filter((p) => p.status === 'ACTIVE' && p.autoRenew);
      return {
        ...a,
        // The price the UI must display. Sending it rather than letting the
        // screen hardcode it is the whole point.
        priceLabel: `₹${a.priceMonthly.toLocaleString('en-IN')} per ${PERIOD_DAYS} days`,
        active: packs.length > 0,
        quantity: packs.length,
        autoRenew: renewing.length > 0,
        // CANCELLED only when every live pack is winding down.
        status: packs.length === 0 ? null : packs.some((p) => p.status === 'ACTIVE') ? 'ACTIVE' : 'CANCELLED',
        // The next pack to end (packs are ordered by end date).
        currentPeriodEnd: packs[0]?.currentPeriodEnd ?? null,
        packs: packs.map((p) => ({ id: p.id, status: p.status, autoRenew: p.autoRenew, currentPeriodEnd: p.currentPeriodEnd })),
      };
    }),
  };
}

// Buying while a pack is live is allowed and adds another pack. `autoRenew`
// rides on the order so the pack is created with it, whichever of the verify
// call or the webhook applies the payment.
export async function createAddonOrder(workspaceId, addonKey, { autoRenew = false } = {}) {
  const addon = getAddon(addonKey);
  // Before an order exists, not after the money has moved.
  assertPurchasable(addon);

  const amount = priceInPaise(addon);
  const client = getRazorpayClient();
  const order = await client.orders.create({
    amount,
    currency: CURRENCY,
    receipt: `addon_${addon.key}_${Date.now().toString(36)}`.slice(0, 40),
    notes: { workspaceId, type: 'addon', addonKey: addon.key, autoRenew: autoRenew ? '1' : '0' },
  }).catch(normalizeRazorpayError);

  return {
    orderId: order.id,
    // Echoed from the created order, not from the request, so the checkout
    // widget opens on exactly what will be captured.
    amount: order.amount,
    currency: order.currency,
    keyId: env.RAZORPAY_KEY_ID,
    addon: { key: addon.key, title: addon.title, priceMonthly: addon.priceMonthly },
  };
}

export async function verifyAddonPayment(workspaceId, { orderId, paymentId, signature } = {}) {
  if (!orderId || !paymentId || !signature) {
    const e = new Error('orderId, paymentId and signature are required'); e.status = 400; throw e;
  }
  if (!verifyPaymentSignature({ orderId, paymentId, signature })) {
    const e = new Error('Payment signature verification failed'); e.status = 400; throw e;
  }

  const client = getRazorpayClient();
  const order = await client.orders.fetch(orderId).catch(normalizeRazorpayError);
  if (order.notes?.workspaceId !== workspaceId || order.notes?.type !== 'addon') {
    const e = new Error('This payment does not belong to your workspace'); e.status = 403; throw e;
  }
  return applyAddonPayment(workspaceId, order, paymentId, 'VERIFY');
}

// Adds the pack for a captured add-on payment exactly once — from the verify
// call above or the Razorpay webhook. The claim, the pack and the invoice
// commit together, so a payment seen twice can never add two packs.
export async function applyAddonPayment(workspaceId, order, paymentId, source = 'VERIFY') {
  const addon = getAddon(order.notes?.addonKey);

  // Amount comes back from the gateway, never from the client.
  const paid = Number(order.amount) / 100;
  const summary = { key: addon.key, title: addon.title };

  const { duplicate, result } = await applyGatewayPaymentOnce(
    { workspaceId, paymentId, orderId: order.id, kind: 'ADDON', amount: paid, currency: order.currency, source },
    async (tx) => {
      // A payment applied before GatewayPayment existed is recognised by its invoice.
      const legacy = await tx.invoice.findFirst({ where: { workspaceId, reference: paymentId } });
      if (legacy) return tx.workspaceAddon.findFirst({ where: { workspaceId, reference: paymentId } });

      // Auto-renew is a per-add-on choice: a new pack follows the packs already
      // renewing, or the box ticked at checkout.
      const now = new Date();
      const renewing = await tx.workspaceAddon.findFirst({
        where: { ...livePacksWhere(workspaceId, addon.key, now), status: 'ACTIVE', autoRenew: true },
        select: { id: true },
      });
      const autoRenew = order.notes?.autoRenew === '1' || order.notes?.autoRenew === true || Boolean(renewing);

      // A new pack, with its own 30 days. Packs already held are left alone,
      // so nothing paid for is shortened or thrown away.
      const record = await tx.workspaceAddon.create({
        data: {
          workspaceId,
          addonKey: addon.key,
          status: 'ACTIVE',
          autoRenew,
          amountPaid: paid,
          currency: order.currency,
          gateway: 'razorpay',
          reference: paymentId,
          currentPeriodEnd: new Date(now.getTime() + PERIOD_MS),
        },
      });

      // An invoice so the purchase appears on the Invoices tab like every other payment.
      await tx.invoice.create({
        data: {
          workspaceId,
          invoiceDate: now,
          description: `${addon.title} (${PERIOD_DAYS}-day pack)`,
          amount: paid,
          currency: order.currency,
          status: 'PAID',
          reference: paymentId,
        },
      });
      return record;
    },
  );

  const record = duplicate
    ? await prisma.workspaceAddon.findFirst({ where: { workspaceId, reference: paymentId } })
    : result;
  const quantity = await prisma.workspaceAddon.count({ where: livePacksWhere(workspaceId, addon.key) })
    .catch((err) => { console.warn(`[Addons] Could not count live ${addon.key} packs for ${workspaceId}:`, err.message); return null; });
  return { ok: true, addon: summary, quantity, currentPeriodEnd: record?.currentPeriodEnd ?? null };
}

// Cancelling stops renewal; every pack stays usable until the period the
// customer already paid for runs out. Removing it immediately would be taking
// back something they have paid for.
export async function cancelAddon(workspaceId, addonKey) {
  const addon = getAddon(addonKey);
  const now = new Date();
  const packs = await prisma.workspaceAddon.findMany({
    where: { ...livePacksWhere(workspaceId, addon.key, now), status: 'ACTIVE' },
    orderBy: { currentPeriodEnd: 'desc' },
  });
  if (packs.length === 0) {
    const e = new Error(`${addon.title} is not active on this workspace.`); e.status = 404; throw e;
  }

  await prisma.workspaceAddon.updateMany({
    where: { id: { in: packs.map((p) => p.id) } },
    data: { status: 'CANCELLED', cancelledAt: now, autoRenew: false },
  });
  const lastEnd = packs[0].currentPeriodEnd;
  return {
    ok: true,
    message: `${addon.title} will stay available until ${lastEnd.toLocaleDateString('en-IN')}.`,
    currentPeriodEnd: lastEnd,
  };
}

// Opt in or out of renewing this add-on's packs from the wallet. Turning it on
// also takes back a cancellation, since a pack that renews is not ending.
export async function setAddonAutoRenew(workspaceId, addonKey, enabled) {
  const addon = getAddon(addonKey);
  if (enabled) assertPurchasable(addon);
  const packs = await prisma.workspaceAddon.findMany({ where: livePacksWhere(workspaceId, addon.key), select: { id: true } });
  if (packs.length === 0) {
    const e = new Error(`${addon.title} is not active on this workspace. Buy a pack first.`); e.status = 404; throw e;
  }
  await prisma.workspaceAddon.updateMany({
    where: { id: { in: packs.map((p) => p.id) } },
    data: enabled ? { autoRenew: true, status: 'ACTIVE', cancelledAt: null } : { autoRenew: false },
  });
  return {
    ok: true,
    autoRenew: Boolean(enabled),
    message: enabled
      ? `${addon.title} will renew from your wallet at ${formatMoney(addon.priceMonthly)} per pack every ${PERIOD_DAYS} days.`
      : `${addon.title} will not renew. It stays available until its current period ends.`,
  };
}

// Whether a workspace may use a given add-on right now. Exported for the
// features that will gate on it.
export async function hasAddon(workspaceId, addonKey) {
  const row = await prisma.workspaceAddon.findFirst({
    where: livePacksWhere(workspaceId, addonKey), select: { id: true },
  }).catch((err) => { console.error(`[Addons] Entitlement lookup failed for ${workspaceId}:`, err.message); return null; });
  return Boolean(row);
}

// ─── Renewal and expiry ──────────────────────────────────────────────────────
//
// Called from the daily billing job (workers/billing.worker.js) and once at
// boot. A pack with auto-renew on is charged its catalogue price from the
// wallet with a key naming the period it pays for, so a re-run or a second
// worker can never charge the same period twice. A pack that is not renewed by
// the time it ends is marked EXPIRED and the workspace is notified.
export async function runAddonRenewalSweep(now = new Date()) {
  const due = await prisma.workspaceAddon.findMany({
    where: {
      status: { in: LIVE },
      OR: [
        { currentPeriodEnd: { lte: now } },
        { status: 'ACTIVE', autoRenew: true, currentPeriodEnd: { lte: new Date(now.getTime() + RENEW_AHEAD_MS) } },
      ],
    },
    orderBy: { currentPeriodEnd: 'asc' },
  });

  let renewed = 0, expired = 0, unpaid = 0, failed = 0, charged = 0;
  const announcements = [];

  for (const row of due) {
    try {
      const addon = ADDONS.find((a) => a.key === row.addonKey);
      const ended = row.currentPeriodEnd <= now;

      if (row.status === 'ACTIVE' && row.autoRenew && addon?.available) {
        const outcome = await renewPack(row, addon, now);
        if (outcome.kind === 'renewed') { renewed += 1; charged += outcome.amount; continue; }
        if (outcome.kind === 'skipped') continue;
        // Not enough in the wallet. Before the end there is still time to top
        // up (the next sweep tries again); after it, the pack expires.
        unpaid += 1;
        if (!ended) {
          announcements.push({
            grouped: true, workspaceId: row.workspaceId,
            key: `addon_renewal_${row.id}_${row.currentPeriodEnd.getTime()}`,
            type: 'ADDON_RENEWAL_PENDING',
            title: `${addon.title} could not be renewed yet`,
            body: `Renewal costs ${formatMoney(addon.priceMonthly)} and the wallet holds ${formatMoney(outcome.balance)}. `
              + `Top up before ${row.currentPeriodEnd.toLocaleDateString('en-IN')} to keep it.`,
            link: 'payments',
            meta: { addonKey: row.addonKey, packId: row.id },
          });
          continue;
        }
        if (await expirePack(row, now)) {
          expired += 1;
          announcements.push({
            workspaceId: row.workspaceId,
            type: 'ADDON_RENEWAL_FAILED',
            title: `${addon.title} has expired`,
            body: `The renewal charge of ${formatMoney(addon.priceMonthly)} could not be collected from the wallet `
              + `(balance ${formatMoney(outcome.balance)}). Top up and buy the pack again from Payments.`,
            link: 'payments',
            meta: { addonKey: row.addonKey, packId: row.id },
          });
        }
        continue;
      }

      if (!ended) continue;
      const wasActive = row.status === 'ACTIVE';
      if (await expirePack(row, now)) {
        expired += 1;
        // A cancelled pack ends as the customer asked; only an unexpected
        // lapse is worth a notification.
        if (wasActive) {
          const title = addon?.title ?? row.addonKey;
          announcements.push({
            workspaceId: row.workspaceId,
            type: 'ADDON_EXPIRED',
            title: `${title} has expired`,
            body: `Your ${PERIOD_DAYS}-day pack has ended. Buy it again from Payments, and switch on auto-renew to have it renewed from your wallet.`,
            link: 'payments',
            meta: { addonKey: row.addonKey, packId: row.id },
          });
        }
      }
    } catch (err) {
      failed += 1;
      console.error(`[Addons] Renewal sweep failed for pack ${row.id}:`, err.message);
    }
  }

  // Outside the transactions, and never fatal: a notification that could not
  // be written must not undo a charge that succeeded.
  await Promise.allSettled(announcements.map(({ grouped, workspaceId, ...note }) => (
    grouped ? notifyWorkspaceGrouped(workspaceId, note) : notifyWorkspace(workspaceId, note)
  )));

  return { processed: due.length, renewed, expired, unpaid, failed, charged };
}

// One renewal, in one transaction: the wallet debit, the period move and the
// invoice commit together or not at all. The period move is conditional on the
// row still being the one that was read, so a concurrent sweep that renewed it
// first turns this into a no-op (and rolls back any debit).
async function renewPack(row, addon, now) {
  const amount = addon.priceMonthly;
  const key = `addon_renew_${row.id}_${row.currentPeriodEnd.getTime()}`;
  try {
    return await prisma.$transaction(async (tx) => {
      const charge = await debit(row.workspaceId, amount, {
        reason: `${addon.title} renewal (${PERIOD_DAYS} days)`,
        reference: row.id,
        category: 'ADDON',
        idempotencyKey: key,
      }, tx);
      if (!charge.ok) return { kind: 'unpaid', balance: charge.balance ?? 0 };

      // The new period starts where the paid one ends, or now if the sweep only
      // reached the pack after it had lapsed — never charging for days gone by.
      const start = Math.max(row.currentPeriodEnd.getTime(), now.getTime());
      const moved = await tx.workspaceAddon.updateMany({
        where: { id: row.id, status: 'ACTIVE', autoRenew: true, currentPeriodEnd: row.currentPeriodEnd },
        data: { currentPeriodEnd: new Date(start + PERIOD_MS), renewedAt: now },
      });
      if (moved.count === 0) throw Object.assign(new Error('pack changed during renewal'), { code: 'ADDON_STALE' });

      if (!charge.alreadyProcessed) {
        await tx.invoice.create({
          data: {
            workspaceId: row.workspaceId,
            invoiceDate: now,
            description: `${addon.title} (${PERIOD_DAYS}-day pack, renewal)`,
            amount,
            currency: row.currency || CURRENCY,
            status: 'PAID',
            reference: key,
          },
        });
      }
      return { kind: 'renewed', amount: charge.alreadyProcessed ? 0 : amount };
    }, { maxWait: 15_000, timeout: 30_000 });
  } catch (err) {
    // Someone else renewed or cancelled it between the read and the write.
    if (err.code === 'ADDON_STALE' || err.code === 'P2002') return { kind: 'skipped' };
    throw err;
  }
}

// Conditional on the row being unchanged, so a pack renewed or re-bought in
// the meantime is not expired, and the notification is sent once.
async function expirePack(row, now) {
  const res = await prisma.workspaceAddon.updateMany({
    where: { id: row.id, status: row.status, currentPeriodEnd: row.currentPeriodEnd },
    data: { status: 'EXPIRED', expiredAt: now, autoRenew: false },
  });
  return res.count > 0;
}

// ─── Entitlement ─────────────────────────────────────────────────────────────
//
// Selling an add-on and honouring it are two different jobs, and only the first
// existed: hasAddon() below had no callers anywhere in the codebase, so every
// purchase granted exactly nothing. These are what the features consult.

// How much of a given capability this workspace has bought.
//
// Every live pack counts, so grants add up across add-ons and across packs of
// the same add-on. `active` is re-derived from the row rather than trusted,
// because a cancelled pack keeps working only until the period it paid for
// runs out.
export async function addonAllowance(workspaceId, capability) {
  const rows = await prisma.workspaceAddon.findMany({ where: { workspaceId } })
    .catch((err) => { console.error(`[Addons] Allowance lookup failed for ${workspaceId}:`, err.message); return []; });
  const now = new Date();
  let total = 0;
  for (const row of rows) {
    if (row.currentPeriodEnd <= now) continue;
    if (!LIVE.includes(row.status)) continue;
    const addon = ADDONS.find((a) => a.key === row.addonKey);
    total += Number(addon?.grants?.[capability] ?? 0);
  }
  return total;
}

// Throws when adding one more would exceed what has been paid for, naming the
// add-on that lifts the limit. The message is the whole point: a bare "limit
// reached" leaves the user with nowhere to go.
export async function assertAddonCapacity(workspaceId, capability, currentCount) {
  const allowed = await addonAllowance(workspaceId, capability);
  if (currentCount < allowed) return;

  const addon = ADDONS.find((a) => a.grants?.[capability] && a.available);
  const label = { customFields: 'custom fields', customEvents: 'custom events' }[capability] ?? capability;
  const e = new Error(
    allowed === 0
      ? `Your plan does not include ${label}.${addon ? ` Add "${addon.title}" from Payments to enable them.` : ''}`
      : `You are using all ${allowed} of your ${label}.${addon ? ` Add another "${addon.title}" for ${addon.grants[capability]} more.` : ''}`,
  );
  e.status = 403;
  e.code = 'ADDON_REQUIRED';
  e.details = { capability, allowed, used: currentCount, addonKey: addon?.key ?? null };
  e.expose = true;
  throw e;
}
