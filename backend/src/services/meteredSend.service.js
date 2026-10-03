import { prisma } from '../lib/prisma.js';
import { consumeMessageCredit, releaseMessageCredit } from './subscription.service.js';
import { describeSendFailure } from './conversations.service.js';
import { normalizePhone } from './optout.service.js';

// Sends that do not start from an inbox thread or a campaign — the public API,
// the OTP API and the API-key playground — go through here so they are billed
// and recorded the same way the inbox is: a unit of quota (or, past it, wallet
// money at the template category's rate) is claimed before Meta is called,
// handed back if Meta refuses, and the accepted message is written to the
// recipient's conversation so it shows in the inbox and receives its delivery
// statuses.

export function creditRefusedError(code) {
  const inactive = code === 'SUBSCRIPTION_INACTIVE';
  const e = new Error(inactive
    ? 'This workspace\'s subscription is inactive. Renew your plan to send messages.'
    : 'Message quota and wallet balance exhausted — recharge your wallet or upgrade your plan');
  e.status = 403;
  e.code = inactive ? 'SUBSCRIPTION_INACTIVE' : 'QUOTA_AND_WALLET_EXHAUSTED';
  e.expose = true;
  return e;
}

/**
 * Claims one message credit, runs `send`, and releases the credit if `send`
 * throws. Meta's rejection is rethrown as the same readable error the inbox
 * gives.
 *
 * @param {() => Promise<any>} send   performs the Meta call
 * @returns {Promise<{ result: any, credit: object }>}
 */
export async function chargeAndSend(workspaceId, { reason, messageCategory = null, send }) {
  const credit = await consumeMessageCredit(workspaceId, { reason, messageCategory });
  if (!credit.ok) throw creditRefusedError(credit.code);

  let result;
  try {
    result = await send();
  } catch (err) {
    await releaseMessageCredit(workspaceId, {
      source: credit.source,
      amount: credit.amount ?? null,
      messageCategory,
    }); // never throws; logs its own failures
    throw err?.status ? err : describeSendFailure(err);
  }
  return { result, credit };
}

// Finds the contact for a phone number, creating it if this is the first
// message to them. Create-then-recover rather than upsert: two concurrent
// sends to a new number must converge on one row, not fail on the
// (workspaceId, phoneNumber) unique constraint.
async function ensureContact(workspaceId, digits) {
  const existing = await prisma.contact.findFirst({
    where: { workspaceId, OR: [{ phoneNumber: digits }, { phoneNumber: `+${digits}` }] },
  });
  if (existing) return existing;

  const phoneNumber = `+${digits}`;
  try {
    return await prisma.contact.create({ data: { workspaceId, name: phoneNumber, phoneNumber } });
  } catch (err) {
    if (err.code !== 'P2002') throw err;
    const raced = await prisma.contact.findUnique({
      where: { workspaceId_phoneNumber: { workspaceId, phoneNumber } },
    });
    if (!raced) throw err;
    return raced;
  }
}

async function ensureConversation(workspaceId, contactId, waNumberId) {
  const where = { workspaceId, contactId, waNumberId };
  const found = await prisma.conversation.findFirst({ where });
  if (found) return found;
  try {
    return await prisma.conversation.create({ data: { ...where, status: 'OPEN' } });
  } catch (err) {
    const raced = await prisma.conversation.findFirst({ where });
    if (raced) return raced;
    throw err;
  }
}

/**
 * Writes an accepted outbound send to the recipient's conversation.
 *
 * Best-effort by design: Meta has already accepted the message and the credit
 * is spent, so a failure to record it is logged rather than turned into an
 * error the caller would retry — which would send the message twice.
 */
export async function recordOutboundMessage(workspaceId, {
  phone, waNumberId, body, type = 'TEXT', metaMessageId = null, senderUserId = null,
}) {
  try {
    const digits = normalizePhone(phone);
    if (!digits || !waNumberId) return null;
    const contact = await ensureContact(workspaceId, digits);
    const conversation = await ensureConversation(workspaceId, contact.id, waNumberId);
    const now = new Date();
    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        body,
        direction: 'OUTBOUND',
        type,
        metaMessageId,
        status: 'SENT',
        statusAt: now,
        senderUserId,
      },
    });
    await prisma.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: now } });
    return message;
  } catch (err) {
    console.error(`[MeteredSend] Sent message ${metaMessageId ?? '?'} could not be recorded for ${workspaceId}:`, err.message);
    return null;
  }
}
