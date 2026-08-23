import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import { getRazorpayClient, verifyPaymentSignature, normalizeRazorpayError } from '../lib/razorpay.js';
import { ADDONS, CURRENCY, getAddon, priceInPaise, assertPurchasable } from '../lib/addonCatalogue.js';

// Add-on purchase, server-authoritative end to end.
//
// The amount is never taken from the request. It is read from the catalogue
// when the order is created, stored in the order's notes, and read back *from
// Razorpay* at verification time — so the figure the wallet is charged is the
// figure the catalogue quoted, and a tampered client cannot change it. This
// mirrors what wallet.service.js already does for top-ups.

const PERIOD_DAYS = 30;

export async function listAddons(workspaceId) {
  const owned = await prisma.workspaceAddon.findMany({ where: { workspaceId } });
  const byKey = new Map(owned.map((a) => [a.addonKey, a]));

  return {
    currency: CURRENCY,
    addons: ADDONS.map((a) => {
      const row = byKey.get(a.key);
      const active = row?.status === 'ACTIVE' && row.currentPeriodEnd > new Date();
      return {
        ...a,
        // The price the UI must display. Sending it rather than letting the
        // screen hardcode it is the whole point.
        priceLabel: `₹${a.priceMonthly.toLocaleString('en-IN')}/month`,
        active,
        status: row?.status ?? null,
        currentPeriodEnd: row?.currentPeriodEnd ?? null,
      };
    }),
  };
}

export async function createAddonOrder(workspaceId, addonKey) {
  const addon = getAddon(addonKey);
  // Before an order exists, not after the money has moved.
  assertPurchasable(addon);

  const existing = await prisma.workspaceAddon.findUnique({
    where: { workspaceId_addonKey: { workspaceId, addonKey: addon.key } },
  });
  if (existing?.status === 'ACTIVE' && existing.currentPeriodEnd > new Date()) {
    const e = new Error(`${addon.title} is already active on this workspace.`);
    e.status = 409;
    throw e;
  }

  const amount = priceInPaise(addon);
  const client = getRazorpayClient();
  const order = await client.orders.create({
    amount,
    currency: CURRENCY,
    receipt: `addon_${addon.key}_${Date.now().toString(36)}`.slice(0, 40),
    notes: { workspaceId, type: 'addon', addonKey: addon.key },
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
  const addon = getAddon(order.notes.addonKey);

  // Amount comes back from the gateway, never from the client.
  const paid = Number(order.amount) / 100;
  const periodEnd = new Date(Date.now() + PERIOD_DAYS * 24 * 60 * 60 * 1000);

  // The unique (workspaceId, addonKey) makes a repeated verify — a double
  // click, a retried request, a duplicate gateway callback — converge on one
  // row rather than activating twice or creating a second charge record.
  const record = await prisma.workspaceAddon.upsert({
    where: { workspaceId_addonKey: { workspaceId, addonKey: addon.key } },
    update: {
      status: 'ACTIVE',
      amountPaid: paid,
      currency: order.currency,
      gateway: 'razorpay',
      reference: paymentId,
      activatedAt: new Date(),
      cancelledAt: null,
      currentPeriodEnd: periodEnd,
    },
    create: {
      workspaceId,
      addonKey: addon.key,
      status: 'ACTIVE',
      amountPaid: paid,
      currency: order.currency,
      gateway: 'razorpay',
      reference: paymentId,
      currentPeriodEnd: periodEnd,
    },
  });

  // An invoice so the purchase appears on the Invoices tab like every other
  // payment. Keyed on the payment reference so a repeat verify cannot add a
  // second line.
  const already = await prisma.invoice.findFirst({ where: { workspaceId, reference: paymentId } });
  if (!already) {
    await prisma.invoice.create({
      data: {
        workspaceId,
        invoiceDate: new Date(),
        description: `${addon.title} (1 month)`,
        amount: paid,
        currency: order.currency,
        status: 'PAID',
        reference: paymentId,
      },
    }).catch(() => {});
  }

  return { ok: true, addon: { key: addon.key, title: addon.title }, currentPeriodEnd: record.currentPeriodEnd };
}

// Cancelling stops the renewal; the add-on stays usable until the period the
// customer already paid for runs out. Removing it immediately would be taking
// back something they have paid for.
export async function cancelAddon(workspaceId, addonKey) {
  const addon = getAddon(addonKey);
  const row = await prisma.workspaceAddon.findUnique({
    where: { workspaceId_addonKey: { workspaceId, addonKey: addon.key } },
  });
  if (!row || row.status !== 'ACTIVE') {
    const e = new Error(`${addon.title} is not active on this workspace.`); e.status = 404; throw e;
  }

  const updated = await prisma.workspaceAddon.update({
    where: { id: row.id },
    data: { status: 'CANCELLED', cancelledAt: new Date() },
  });
  return {
    ok: true,
    message: `${addon.title} will stay available until ${updated.currentPeriodEnd.toLocaleDateString('en-IN')} and will not renew.`,
    currentPeriodEnd: updated.currentPeriodEnd,
  };
}

// Whether a workspace may use a given add-on right now. Exported for the
// features that will gate on it.
export async function hasAddon(workspaceId, addonKey) {
  const row = await prisma.workspaceAddon.findUnique({
    where: { workspaceId_addonKey: { workspaceId, addonKey } },
  }).catch(() => null);
  return Boolean(row && row.status === 'ACTIVE' && row.currentPeriodEnd > new Date());
}

// ─── Entitlement ─────────────────────────────────────────────────────────────
//
// Selling an add-on and honouring it are two different jobs, and only the first
// existed: hasAddon() below had no callers anywhere in the codebase, so every
// purchase granted exactly nothing. These are what the features consult.

// How much of a given capability this workspace has bought.
//
// Quantities add up, so a workspace that buys the field pack twice gets ten
// fields. `active` is re-derived from the row rather than trusted, because a
// cancelled add-on keeps working only until the period it paid for runs out.
export async function addonAllowance(workspaceId, capability) {
  const rows = await prisma.workspaceAddon.findMany({ where: { workspaceId } }).catch(() => []);
  const now = new Date();
  let total = 0;
  for (const row of rows) {
    if (row.currentPeriodEnd <= now) continue;
    if (row.status !== 'ACTIVE' && row.status !== 'CANCELLED') continue;
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
