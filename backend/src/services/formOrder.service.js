// Owner-approved orders.
//
// With this turned on for an order form, finishing the form no longer confirms
// the order. It goes to the owner on WhatsApp, who has it as one message with
// buttons, and moves through these states:
//
//   PENDING_OWNER      the owner taps Available, Edit quantities or Cancel order
//   OWNER_EDITING      the owner is typing the quantities stock allows
//   PENDING_CUSTOMER   the customer accepts or rejects the revised quantities
//   AWAITING_PAYMENT   the customer has the final price and payment details,
//                      and may still edit or delete the order
//   PAYMENT_REVIEW     the customer sent a screenshot; the owner confirms it
//   CONFIRMED          today's stock is reduced; the order is final
//   DISPATCHED         the owner marked it sent
//   CANCELLED          by the owner, by the customer, or for silence
//
// Every button carries the order it belongs to (lib/orderText.js actionId), so
// the owner can have several orders open at once. The quantities and address
// stay in the form submission the order came from; `answers.__status` there
// mirrors PENDING / CONFIRMED / CANCELLED, which is what today's stock counts.
//
// Everything is a free-form WhatsApp message, so it relies on the 24-hour
// window: the customer is mid-conversation, and the owner must have messaged
// the business number in the last 24 hours. When the owner cannot be reached
// the workspace is notified, and any message from the owner re-sends every
// order that is waiting for them.

import { prisma } from '../lib/prisma.js';
import { decrypt } from '../lib/encryption.js';
import {
  sendTextMessage, sendReplyButtons, sendMediaMessage, uploadPhoneMedia, downloadMediaBuffer,
} from '../lib/meta.js';
import { renderFormMessage, closingTotal } from '../lib/formMessage.js';
import {
  itemLines, detailLines, numberFields, shortLabel, showNumber, rupees,
  parseQuantities, actionId, parseAction, samePhone, pastCutoff, isCutoffTime,
} from '../lib/orderText.js';
import { notifyWorkspace } from './notification.service.js';
import { stockFor } from './whatsappFormStock.service.js';

const WAITING_ON_CUSTOMER = ['PENDING_CUSTOMER', 'AWAITING_PAYMENT'];
const OPEN = ['PENDING_OWNER', 'OWNER_EDITING', 'PENDING_CUSTOMER', 'AWAITING_PAYMENT', 'PAYMENT_REVIEW'];
const OWNER_ACTIONS = new Set(['ok', 'change', 'cancel', 'paid', 'sent']);
const CUSTOMER_ACTIONS = new Set(['accept', 'reject', 'edit', 'delete']);

const STATUS_WORDS = {
  PENDING_OWNER: 'waiting for your answer',
  OWNER_EDITING: 'waiting for your quantities',
  PENDING_CUSTOMER: 'waiting for the customer',
  AWAITING_PAYMENT: 'waiting for payment',
  PAYMENT_REVIEW: 'waiting for you to confirm the payment',
  CONFIRMED: 'confirmed',
  DISPATCHED: 'dispatched',
  CANCELLED: 'cancelled',
};

function fail(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

const schemaOf = (form) => (Array.isArray(form?.schema) ? form.schema : []);

const duration = (minutes) => {
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? '' : 's'}`;
  return `${minutes} minutes`;
};

const plus = (phone) => `+${String(phone ?? '').replace(/\D/g, '')}`;

// ── Settings ───────────────────────────────────────────────────────────────

async function findFlow(formId) {
  try {
    return await prisma.whatsappFormOrderFlow.findUnique({ where: { formId } });
  } catch (err) {
    console.warn(`[Orders] Could not read order settings for form ${formId}: ${String(err.message).split('\n')[0]}`);
    return null;
  }
}

/** The form's order settings when owner approval is on, else null. Never throws. */
export async function activeFlow(form) {
  if (!form?.id) return null;
  const flow = await findFlow(form.id);
  return flow?.enabled && flow.ownerPhone ? flow : null;
}

async function enabledFlows(workspaceId) {
  try {
    const rows = await prisma.whatsappFormOrderFlow.findMany({ where: { workspaceId, enabled: true } });
    return rows.filter((f) => f.ownerPhone);
  } catch {
    return [];
  }
}

/**
 * The message to send instead of starting the form when it is past the day's
 * cutoff, or null when orders are open.
 */
export async function ordersClosedMessage(form) {
  const flow = await activeFlow(form);
  if (!flow || !pastCutoff(flow.cutoffTime, flow.timezone)) return null;
  return `Orders for tomorrow's delivery are closed for today. You can pre-book the next day's order from tomorrow morning${form.keyword ? `: send ${form.keyword}` : ''}.`;
}

const publicFlow = (flow) => ({
  enabled: flow?.enabled === true,
  ownerPhone: flow?.ownerPhone || '',
  upiId: flow?.upiId || '',
  payeeName: flow?.payeeName || '',
  bankDetails: flow?.bankDetails || '',
  hasQr: Boolean(flow?.qrImage),
  replyMinutes: flow?.replyMinutes ?? 60,
  paymentMinutes: flow?.paymentMinutes ?? 120,
  cutoffTime: flow?.cutoffTime || '',
  timezone: flow?.timezone || 'Asia/Kolkata',
});

async function loadForm(workspaceId, formId) {
  const form = await prisma.whatsappForm.findFirst({ where: { id: formId, workspaceId } });
  if (!form) throw fail(404, 'Form not found');
  return form;
}

export async function getOrderFlow(workspaceId, formId) {
  await loadForm(workspaceId, formId);
  return publicFlow(await findFlow(formId));
}

const minutesIn = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 5 || n > 1440) throw fail(400, 'Waiting times must be between 5 minutes and 24 hours.');
  return n;
};

export async function saveOrderFlow(workspaceId, formId, input = {}) {
  await loadForm(workspaceId, formId);
  const current = await findFlow(formId);

  const phoneDigits = String(input.ownerPhone ?? current?.ownerPhone ?? '').replace(/\D/g, '');
  if (phoneDigits && (phoneDigits.length < 10 || phoneDigits.length > 15)) {
    throw fail(400, "Enter the owner's WhatsApp number with the country code, for example +919876543210.");
  }
  const enabled = input.enabled === undefined ? current?.enabled === true : input.enabled === true;
  if (enabled && !phoneDigits) throw fail(400, "Add the owner's WhatsApp number before turning this on.");

  const cutoff = String(input.cutoffTime ?? current?.cutoffTime ?? '').trim();
  if (cutoff && !isCutoffTime(cutoff)) throw fail(400, 'The cutoff time must look like 18:00.');

  const text = (key, max) => {
    const value = input[key] === undefined ? current?.[key] : input[key];
    return String(value ?? '').trim().slice(0, max) || null;
  };
  const data = {
    enabled,
    ownerPhone: phoneDigits ? `+${phoneDigits}` : null,
    upiId: text('upiId', 120),
    payeeName: text('payeeName', 120),
    bankDetails: text('bankDetails', 600),
    replyMinutes: minutesIn(input.replyMinutes, current?.replyMinutes ?? 60),
    paymentMinutes: minutesIn(input.paymentMinutes, current?.paymentMinutes ?? 120),
    cutoffTime: cutoff || null,
  };

  try {
    await prisma.whatsappFormOrderFlow.upsert({
      where: { formId },
      create: { workspaceId, formId, ...data },
      update: data,
    });
  } catch (err) {
    console.error(`[Orders] Could not save order settings for form ${formId}: ${err.message}`);
    throw fail(500, 'The settings could not be saved. If this is a new deployment, the database update may not have run yet.');
  }
  return publicFlow(await findFlow(formId));
}

/** Stores (or, with no image, removes) the owner's UPI QR code. */
export async function saveOrderFlowQr(workspaceId, formId, image) {
  await loadForm(workspaceId, formId);
  const data = image
    ? { qrImage: image.buffer, qrMime: image.mimeType }
    : { qrImage: null, qrMime: null };
  if (image && image.buffer.length > 2 * 1024 * 1024) throw fail(400, 'The QR image must be under 2 MB.');
  await prisma.whatsappFormOrderFlow.upsert({
    where: { formId },
    create: { workspaceId, formId, ...data },
    update: data,
  });
  return publicFlow(await findFlow(formId));
}

/** Recent orders of a form, newest first, for the form editor. */
export async function listOrders(workspaceId, formId) {
  await loadForm(workspaceId, formId);
  let rows;
  try {
    rows = await prisma.whatsappFormOrder.findMany({
      where: { workspaceId, formId }, orderBy: { createdAt: 'desc' }, take: 50,
    });
  } catch {
    return [];
  }
  const ids = [...new Set(rows.map((r) => r.contactId))];
  const contacts = ids.length
    ? await prisma.contact.findMany({ where: { workspaceId, id: { in: ids } }, select: { id: true, name: true, phoneNumber: true } })
    : [];
  const byId = new Map(contacts.map((c) => [c.id, c]));
  return rows.map((r) => ({
    id: r.id, number: r.number, status: r.status, cancelReason: r.cancelReason, total: r.total,
    createdAt: r.createdAt, contactName: byId.get(r.contactId)?.name ?? null, contactPhone: byId.get(r.contactId)?.phoneNumber ?? null,
  }));
}

// ── Sending ────────────────────────────────────────────────────────────────

// One WhatsApp message (text, buttons, or an image with a caption), recorded
// in the conversation so the Inbox shows it. Returns whether Meta accepted it.
async function deliver(waNumber, conversationId, toPhone, { body, buttons, image }) {
  try {
    const token = decrypt(waNumber.encryptedAccessToken);
    const pn = waNumber.metaPhoneNumberId;
    let result;
    if (image) {
      const mediaId = await uploadPhoneMedia({ phoneNumberId: pn, accessToken: token, buffer: image.buffer, mimeType: image.mimeType, fileName: 'image' });
      result = await sendMediaMessage(pn, token, toPhone, { mediaId, type: 'image', caption: body });
    } else if (buttons?.length) {
      result = await sendReplyButtons(pn, token, toPhone, { body, buttons });
    } else {
      result = await sendTextMessage(pn, token, toPhone, body);
    }
    if (conversationId) {
      const stored = [image ? '[image]' : null, body, ...(buttons?.length ? ['', ...buttons.map((b) => `• ${b.title}`)] : [])]
        .filter((line) => line !== null).join('\n');
      await prisma.message.create({
        data: {
          conversationId, body: stored, direction: 'OUTBOUND', type: 'TEXT',
          metaMessageId: result?.messages?.[0]?.id, status: 'SENT', statusAt: new Date(), sentAt: new Date(),
        },
      });
      await prisma.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date() } });
    }
    return true;
  } catch (err) {
    const meta = err?.response?.data?.error;
    console.error(`[Orders] Message to ${toPhone} failed:`, meta?.message || err.message);
    return false;
  }
}

// The owner's own conversation with the business number, if they have one.
async function ownerConversationId(workspaceId, ownerPhone, waNumberId) {
  const d = String(ownerPhone).replace(/\D/g, '');
  const contact = await prisma.contact.findFirst({
    where: { workspaceId, OR: [{ phoneNumber: `+${d}` }, { phoneNumber: d }] },
  });
  if (!contact) return null;
  const conversation = await prisma.conversation.findFirst({ where: { workspaceId, contactId: contact.id, waNumberId } });
  return conversation?.id ?? null;
}

// Everything needed to act on an order, loaded once.
async function contextFor(order) {
  const [form, submission, contact, conversation] = await Promise.all([
    prisma.whatsappForm.findFirst({ where: { id: order.formId, workspaceId: order.workspaceId } }),
    prisma.whatsappFormSubmission.findFirst({ where: { id: order.submissionId, workspaceId: order.workspaceId } }),
    prisma.contact.findUnique({ where: { id: order.contactId } }),
    prisma.conversation.findUnique({ where: { id: order.conversationId } }),
  ]);
  if (!form || !submission || !contact || !conversation) return null;
  const [flow, waNumber] = await Promise.all([
    findFlow(form.id),
    prisma.waNumber.findUnique({ where: { id: conversation.waNumberId } }),
  ]);
  if (!flow?.ownerPhone || !waNumber) return null;
  const ownerConv = await ownerConversationId(order.workspaceId, flow.ownerPhone, waNumber.id);
  return {
    order, form, fields: schemaOf(form), flow, submission, contact, waNumber, ownerConv,
    answers: submission.answers && typeof submission.answers === 'object' ? submission.answers : {},
    ref: `#${order.number}`,
  };
}

const toCustomer = (ctx, message) => deliver(ctx.waNumber, ctx.order.conversationId, ctx.contact.phoneNumber, message);

async function toOwner(ctx, message) {
  const ok = await deliver(ctx.waNumber, ctx.ownerConv, plus(ctx.flow.ownerPhone), message);
  if (!ok) {
    await notifyWorkspace(ctx.order.workspaceId, {
      type: 'ORDER',
      title: `Order ${ctx.ref} could not be sent to the owner on WhatsApp`,
      body: 'WhatsApp only delivers these messages within 24 hours of the owner\'s last message. '
        + 'Ask the owner to send any message to your business number; every waiting order is then sent again.',
      link: 'automation',
    }).catch(() => {});
  }
  return ok;
}

// ── What an order looks like in a message ──────────────────────────────────

const orderLines = (ctx) => [...itemLines(ctx.fields, ctx.answers), ...detailLines(ctx.fields, ctx.answers)].join('\n');

const totalOf = (ctx) => closingTotal(ctx.form.completionMessage, { contact: ctx.contact, fields: ctx.fields, answers: ctx.answers });

const totalLine = (total) => (total === null || total === undefined ? '' : `\nTotal ₹${rupees(total)}`);

// The priced receipt the form's own closing message describes, when it has
// one; otherwise the plain list of what was ordered.
function receipt(ctx, total) {
  const closing = String(ctx.form.completionMessage || '');
  if (closing.includes('{{')) return renderFormMessage(closing, { contact: ctx.contact, fields: ctx.fields, answers: ctx.answers });
  return `${orderLines(ctx)}${totalLine(total)}`;
}

const prebook = (ctx) => (ctx.form.keyword
  ? `You can pre-book tomorrow's order: send ${ctx.form.keyword} any time.`
  : "You can pre-book tomorrow's order any time.");

async function stockLeftLine(form) {
  const stock = await stockFor(form);
  if (!stock.active) return '';
  const parts = Object.values(stock.items).map((i) => `${shortLabel(i.label)}: ${showNumber(i.left)}`);
  return parts.length ? `\n\nStock left today\n${parts.map((p) => `• ${p}`).join('\n')}` : '';
}

// The message the owner acts on, for the state the order is in.
async function ownerCard(ctx) {
  const who = `${ctx.contact.name || 'Customer'} (${ctx.contact.phoneNumber})`;
  if (ctx.order.status === 'PAYMENT_REVIEW') {
    return {
      body: `Order ${ctx.ref}: payment screenshot from ${who}.${totalLine(ctx.order.total)}\n\nConfirm when the payment has arrived.`,
      buttons: [{ id: actionId(ctx.order.id, 'paid'), title: 'Confirm payment' }],
    };
  }
  return {
    body: `New order ${ctx.ref}\n${who}\n${orderLines(ctx)}${totalLine(ctx.order.total)}${await stockLeftLine(ctx.form)}`,
    buttons: [
      { id: actionId(ctx.order.id, 'ok'), title: 'Available' },
      { id: actionId(ctx.order.id, 'change'), title: 'Edit quantities' },
      { id: actionId(ctx.order.id, 'cancel'), title: 'Cancel order' },
    ],
  };
}

// ── State changes ──────────────────────────────────────────────────────────

async function setSubmission(ctx, patch) {
  ctx.answers = { ...ctx.answers, ...patch };
  await prisma.whatsappFormSubmission.update({ where: { id: ctx.submission.id }, data: { answers: ctx.answers } });
}

async function setOrder(ctx, data) {
  ctx.order = await prisma.whatsappFormOrder.update({ where: { id: ctx.order.id }, data });
  return ctx.order;
}

async function cancelOrder(ctx, reason) {
  await setOrder(ctx, { status: 'CANCELLED', cancelReason: reason, expiresAt: null });
  await setSubmission(ctx, { __status: 'CANCELLED' });
}

/**
 * A customer has just finished the order form. Opens the order, tells the
 * customer it is being checked, and sends it to the owner.
 */
export async function placeOrder({ workspaceId, form, submission, contact, answers }) {
  const number = (await prisma.whatsappFormOrder.count({ where: { workspaceId, formId: form.id } })) + 1;
  const total = closingTotal(form.completionMessage, { contact, fields: schemaOf(form), answers });
  const order = await prisma.whatsappFormOrder.create({
    data: {
      workspaceId, formId: form.id, submissionId: submission.id, contactId: contact.id,
      conversationId: submission.conversationId, number, status: 'PENDING_OWNER', total,
    },
  });
  const ctx = await contextFor(order);
  if (!ctx) return order;

  await toCustomer(ctx, {
    body: `Thank you${contact.name ? ` ${contact.name}` : ''}. We have received your order ${ctx.ref}:\n${orderLines(ctx)}\n\nWe are checking stock and will confirm it shortly.`,
  });
  await toOwner(ctx, await ownerCard(ctx));
  return order;
}

// The customer gets the final price and how to pay; the clock starts.
async function requestPayment(ctx) {
  const total = totalOf(ctx);
  const minutes = ctx.flow.paymentMinutes;
  await setOrder(ctx, { status: 'AWAITING_PAYMENT', total, expiresAt: new Date(Date.now() + minutes * 60_000) });

  if (ctx.flow.qrImage) {
    await toCustomer(ctx, {
      image: { buffer: Buffer.from(ctx.flow.qrImage), mimeType: ctx.flow.qrMime || 'image/png' },
      body: `Scan to pay${total === null ? '' : ` ₹${rupees(total)}`} for order ${ctx.ref}`,
    });
  }
  const pay = [
    ctx.flow.upiId ? `UPI ID: ${ctx.flow.upiId}` : null,
    ctx.flow.payeeName ? `Name: ${ctx.flow.payeeName}` : null,
    ctx.flow.bankDetails ? `\nBank details\n${ctx.flow.bankDetails}` : null,
  ].filter(Boolean).join('\n');
  await toCustomer(ctx, {
    body: `Order ${ctx.ref} is available ✅\n\n${receipt(ctx, total)}\n\nPlease pay${total === null ? '' : ` ₹${rupees(total)}`} within ${duration(minutes)}.${pay ? `\n${pay}` : ''}`,
  });
  await toCustomer(ctx, {
    body: 'After paying, send the payment screenshot here.\n\nBefore paying you can still change or delete the order.',
    buttons: [
      { id: actionId(ctx.order.id, 'edit'), title: 'Edit order' },
      { id: actionId(ctx.order.id, 'delete'), title: 'Delete order' },
    ],
  });
}

async function confirmOrder(ctx) {
  await setOrder(ctx, { status: 'CONFIRMED', confirmedAt: new Date(), expiresAt: null });
  // From here the order counts against today's stock.
  await setSubmission(ctx, { __status: 'CONFIRMED' });
  await toCustomer(ctx, {
    body: `Your order ${ctx.ref} is confirmed ✅\n${orderLines(ctx)}${totalLine(ctx.order.total)}\n\nWe will message you when it is dispatched.`,
  });
  await toOwner(ctx, {
    body: `Order ${ctx.ref} is confirmed and the customer has been told.${await stockLeftLine(ctx.form)}`,
    buttons: [{ id: actionId(ctx.order.id, 'sent'), title: 'Mark dispatched' }],
  });
}

// ── The owner ──────────────────────────────────────────────────────────────

async function ownerAction(ctx, action) {
  const { status } = ctx.order;
  const already = () => toOwner(ctx, { body: `Order ${ctx.ref} is already ${STATUS_WORDS[status] || status.toLowerCase()}.` });

  if (action === 'ok') {
    if (!['PENDING_OWNER', 'OWNER_EDITING'].includes(status)) return already();
    await requestPayment(ctx);
    return toOwner(ctx, { body: `Order ${ctx.ref} marked available. The price and payment details have been sent to the customer.` });
  }

  if (action === 'change') {
    if (!['PENDING_OWNER', 'OWNER_EDITING'].includes(status)) return already();
    // One order is edited at a time: the quantities typed next belong to this one.
    await prisma.whatsappFormOrder.updateMany({
      where: { workspaceId: ctx.order.workspaceId, formId: ctx.order.formId, status: 'OWNER_EDITING', id: { not: ctx.order.id } },
      data: { status: 'PENDING_OWNER' },
    });
    await setOrder(ctx, { status: 'OWNER_EDITING' });
    const items = numberFields(ctx.fields);
    const list = items.map((f, i) => `${i + 1}. ${shortLabel(f.label)} (now ${showNumber(Number(ctx.answers[f.key]) || 0)})`).join('\n');
    return toOwner(ctx, {
      body: `Send the quantities you can supply for order ${ctx.ref}, in this order, separated by commas:\n${list}\n\nExample: ${items.map((_, i) => i + 1).join(', ')}`,
    });
  }

  if (action === 'cancel') {
    if (!OPEN.includes(status)) return already();
    await cancelOrder(ctx, 'owner');
    await toCustomer(ctx, { body: `Sorry, your order ${ctx.ref} has been cancelled.` });
    return toOwner(ctx, { body: `Order ${ctx.ref} cancelled. The customer has been told.` });
  }

  if (action === 'paid') {
    if (!['PAYMENT_REVIEW', 'AWAITING_PAYMENT'].includes(status)) return already();
    return confirmOrder(ctx);
  }

  if (action === 'sent') {
    if (status !== 'CONFIRMED') return already();
    await setOrder(ctx, { status: 'DISPATCHED' });
    await toCustomer(ctx, { body: `Your order ${ctx.ref} has been dispatched and is on its way. 🚚` });
    return toOwner(ctx, { body: `Order ${ctx.ref} marked dispatched. The customer has been told.` });
  }
  return null;
}

// The owner typed the quantities stock allows. They go to the customer to accept.
async function applyRevision(ctx, quantities) {
  const items = numberFields(ctx.fields);
  if (quantities.every((q) => q === 0)) {
    return toOwner(ctx, { body: `All quantities are 0. To drop order ${ctx.ref}, tap Cancel order on its message instead.` });
  }
  await setSubmission(ctx, Object.fromEntries(items.map((f, i) => [f.key, showNumber(quantities[i])])));
  const total = totalOf(ctx);
  const minutes = ctx.flow.replyMinutes;
  await setOrder(ctx, { status: 'PENDING_CUSTOMER', total, expiresAt: new Date(Date.now() + minutes * 60_000) });

  await toCustomer(ctx, {
    body: `For order ${ctx.ref} we can supply:\n${orderLines(ctx)}${totalLine(total)}\n\nDo you accept? Please answer within ${duration(minutes)}.`,
    buttons: [
      { id: actionId(ctx.order.id, 'accept'), title: 'Accept' },
      { id: actionId(ctx.order.id, 'reject'), title: 'Reject' },
    ],
  });
  return toOwner(ctx, { body: `Revised order ${ctx.ref} sent to the customer. Waiting for their answer.` });
}

// Anything the owner sends that is not a button tap: the quantities for the
// order being edited, or a nudge that re-sends every order waiting on them.
async function ownerMessage({ flows, waNumber, conversation, fromPhone, parsed }) {
  const formIds = flows.map((f) => f.formId);
  const say = (body) => deliver(waNumber, conversation.id, plus(fromPhone), { body });

  const editing = await prisma.whatsappFormOrder.findFirst({
    where: { formId: { in: formIds }, status: 'OWNER_EDITING' }, orderBy: { updatedAt: 'desc' },
  });
  const typed = parsed?.type === 'TEXT' ? String(parsed.body || '').trim() : '';

  if (editing && typed) {
    const ctx = await contextFor(editing);
    if (ctx) {
      const count = numberFields(ctx.fields).length;
      const quantities = parseQuantities(typed, count);
      if (quantities) { await applyRevision(ctx, quantities); return true; }
      await say(`I could not read that. For order ${ctx.ref} send ${count} number${count === 1 ? '' : 's'} separated by commas, for example: ${Array.from({ length: count }, (_, i) => i + 1).join(', ')}`);
      return true;
    }
  }

  const waiting = await prisma.whatsappFormOrder.findMany({
    where: { formId: { in: formIds }, status: { in: ['PENDING_OWNER', 'PAYMENT_REVIEW'] } },
    orderBy: { createdAt: 'asc' }, take: 10,
  });
  if (waiting.length === 0) { await say('No orders are waiting for you.'); return true; }
  for (const order of waiting) {
    const ctx = await contextFor(order);
    if (ctx) await toOwner(ctx, await ownerCard(ctx));
  }
  return true;
}

// ── The customer ───────────────────────────────────────────────────────────

async function customerAction(ctx, action, { conversation }) {
  const { status } = ctx.order;
  const closed = () => toCustomer(ctx, { body: `Order ${ctx.ref} is ${STATUS_WORDS[status] === 'confirmed' ? 'already confirmed and can no longer be changed' : `already ${STATUS_WORDS[status] || 'closed'}`}.` });

  if (action === 'accept') {
    if (status !== 'PENDING_CUSTOMER') return closed();
    await requestPayment(ctx);
    return toOwner(ctx, { body: `The customer accepted the revised order ${ctx.ref}. Payment details have been sent.` });
  }

  if (action === 'reject') {
    if (status !== 'PENDING_CUSTOMER') return closed();
    await cancelOrder(ctx, 'customer_rejected');
    await toCustomer(ctx, { body: `Order ${ctx.ref} is cancelled. ${prebook(ctx)}` });
    return toOwner(ctx, { body: `The customer did not accept the revised order ${ctx.ref}. It is cancelled.` });
  }

  if (action === 'delete') {
    if (!['PENDING_OWNER', 'PENDING_CUSTOMER', 'AWAITING_PAYMENT'].includes(status)) return closed();
    await cancelOrder(ctx, 'customer_deleted');
    await toCustomer(ctx, { body: `Order ${ctx.ref} has been deleted.` });
    return toOwner(ctx, { body: `The customer deleted order ${ctx.ref}.` });
  }

  if (action === 'edit') {
    if (status !== 'AWAITING_PAYMENT') return closed();
    // An edited order is a new order: the form runs again and its result goes
    // back to the owner for a fresh stock check.
    await cancelOrder(ctx, 'customer_edit');
    await toOwner(ctx, { body: `The customer is changing order ${ctx.ref}. A new order will follow.` });
    if (ctx.form.keyword) {
      const { handleFormInbound } = await import('./whatsappForms.service.js');
      await handleFormInbound({
        workspaceId: ctx.order.workspaceId, conversation, contact: ctx.contact, messageBody: ctx.form.keyword,
      });
    }
    return true;
  }
  return null;
}

// A picture from a customer who has been asked to pay is the payment
// screenshot: it goes to the owner, who confirms the order.
async function paymentProof({ flows, waNumber, contact, parsed }) {
  const order = await prisma.whatsappFormOrder.findFirst({
    where: { contactId: contact.id, formId: { in: flows.map((f) => f.formId) }, status: { in: ['AWAITING_PAYMENT', 'PAYMENT_REVIEW'] } },
    orderBy: { createdAt: 'desc' },
  });
  if (!order) return false;
  const ctx = await contextFor(order);
  if (!ctx) return false;

  await setOrder(ctx, { status: 'PAYMENT_REVIEW', expiresAt: null });

  let forwarded = false;
  try {
    const media = await downloadMediaBuffer(parsed.media.mediaId, decrypt(waNumber.encryptedAccessToken));
    forwarded = await deliver(ctx.waNumber, ctx.ownerConv, plus(ctx.flow.ownerPhone), {
      image: { buffer: media.buffer, mimeType: parsed.media.mediaMimeType || media.mimeType || 'image/jpeg' },
      body: `Payment screenshot for order ${ctx.ref}`,
    });
  } catch (err) {
    console.error(`[Orders] Could not forward the payment screenshot for order ${order.id}: ${err.message}`);
  }
  const card = await ownerCard(ctx);
  if (!forwarded) card.body += '\n\n(The screenshot could not be forwarded. Open the chat in the Inbox to see it.)';
  await toOwner(ctx, card);
  await toCustomer(ctx, { body: `Thank you. We have received your payment screenshot for order ${ctx.ref} and are checking it.` });
  return true;
}

/**
 * Called for every inbound message, before forms and workflows. Returns true
 * when the message belonged to an order (a button tap, anything from the
 * owner's number, or a payment screenshot) and was dealt with here.
 */
export async function handleOrderInbound({ workspaceId, waNumber, conversation, contact, fromPhone, parsed }) {
  try {
    const tapped = parseAction(parsed?.buttonPayload);
    if (tapped) {
      const order = await prisma.whatsappFormOrder.findFirst({ where: { id: tapped.orderId, workspaceId } });
      if (!order) return false;
      const ctx = await contextFor(order);
      if (!ctx) return false;
      // A button only works for the person it was sent to.
      if (OWNER_ACTIONS.has(tapped.action)) {
        if (!samePhone(ctx.flow.ownerPhone, fromPhone)) return true;
        ctx.ownerConv = conversation.id;
        await ownerAction(ctx, tapped.action);
        return true;
      }
      if (CUSTOMER_ACTIONS.has(tapped.action)) {
        if (order.contactId !== contact.id) return true;
        await customerAction(ctx, tapped.action, { conversation });
        return true;
      }
      return false;
    }

    const flows = await enabledFlows(workspaceId);
    if (flows.length === 0) return false;

    const owned = flows.filter((f) => samePhone(f.ownerPhone, fromPhone));
    if (owned.length) return await ownerMessage({ flows: owned, waNumber, conversation, fromPhone, parsed });

    if (parsed?.type === 'IMAGE' && parsed.media?.mediaId) {
      return await paymentProof({ flows, waNumber, contact, parsed });
    }
    return false;
  } catch (err) {
    console.error('[Orders] Inbound handling failed:', err.message);
    return false;
  }
}

// ── Time limits ────────────────────────────────────────────────────────────

/**
 * Cancels orders whose customer went quiet: no answer to a revised order, or
 * no payment, within the time allowed. Returns how many were cancelled.
 */
export async function sweepExpiredOrders(now = new Date()) {
  const due = await prisma.whatsappFormOrder.findMany({
    where: { status: { in: WAITING_ON_CUSTOMER }, expiresAt: { lt: now } }, take: 50,
  });
  let cancelled = 0;
  for (const order of due) {
    try {
      const unpaid = order.status === 'AWAITING_PAYMENT';
      // Claim it first. The condition repeats the query's, so if the customer
      // answered in the meantime, or another server instance got here first,
      // nothing matches and nobody is messaged twice.
      const claimed = await prisma.whatsappFormOrder.updateMany({
        where: { id: order.id, status: order.status, expiresAt: { lt: now } },
        data: { status: 'CANCELLED', cancelReason: unpaid ? 'no_payment' : 'no_reply', expiresAt: null },
      });
      if (claimed.count !== 1) continue;

      const ctx = await contextFor({ ...order, status: 'CANCELLED' });
      if (!ctx) continue;
      await setSubmission(ctx, { __status: 'CANCELLED' });
      await toCustomer(ctx, {
        body: unpaid
          ? `We did not receive the payment for order ${ctx.ref} in time, so it has been cancelled. ${prebook(ctx)}`
          : `We did not hear back about order ${ctx.ref}, so it has been cancelled. ${prebook(ctx)}`,
      });
      await toOwner(ctx, { body: `Order ${ctx.ref} was cancelled: ${unpaid ? 'no payment' : 'no answer'} from the customer in time.` });
      cancelled += 1;
    } catch (err) {
      console.error(`[Orders] Could not expire order ${order.id}: ${err.message}`);
    }
  }
  return cancelled;
}

let sweepTimer = null;
let sweepRunning = false;
let sweepWarned = false;

/** Checks the time limits once a minute. Needs no queue; safe to call twice. */
export function startOrderSweep(intervalMs = 60_000) {
  if (sweepTimer) return sweepTimer;
  sweepTimer = setInterval(async () => {
    if (sweepRunning) return;
    sweepRunning = true;
    try {
      await sweepExpiredOrders();
    } catch (err) {
      // Most likely the tables are not there yet; say so once, not every minute.
      if (!sweepWarned) console.warn(`[Orders] Time-limit check skipped: ${String(err.message).split('\n')[0]}`);
      sweepWarned = true;
    } finally {
      sweepRunning = false;
    }
  }, intervalMs);
  sweepTimer.unref?.();
  return sweepTimer;
}
