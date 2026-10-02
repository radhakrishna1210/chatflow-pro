import { prisma } from '../lib/prisma.js';
import { deliverAutomatedReply } from './outbound.service.js';

// Sends one sequence message. Kept out of the engine so the engine stays free
// of provider concerns and testable without a live number.
//
// Messages are written into the contact's existing conversation so a sequence
// message and a human reply sit in one thread, which is what makes
// exit-on-reply meaningful.
//
// Goes through deliverAutomatedReply like every other automated send, so it is
// metered against the workspace's quota/wallet, honours the OptOut list and the
// 24-hour window, and stores a real Message row. Any failure throws: the engine
// records the step and the enrollment as FAILED with the reason, instead of the
// old behaviour of writing a DELIVERED row for a message that never went out.
export async function sendSequenceMessage({ enrollment, body }) {
  const contact = await prisma.contact.findUnique({
    where: { id: enrollment.contactId },
    select: { id: true, phoneNumber: true, optedOut: true },
  });
  if (!contact) throw new Error('Contact no longer exists');
  if (contact.optedOut) throw new Error('Contact opted out');

  const conversation = await prisma.conversation.findFirst({
    where: { workspaceId: enrollment.workspaceId, contactId: contact.id },
    orderBy: { lastMessageAt: 'desc' },
    select: { id: true, waNumberId: true },
  });
  // A sequence message is free-form text, which WhatsApp only accepts inside
  // the 24-hour window that the customer's own message opens. A contact with no
  // conversation has never written in, so there is nothing to send into.
  if (!conversation) {
    throw new Error('The contact has never messaged this workspace, so a free-form sequence message cannot be sent (WhatsApp requires an approved template)');
  }

  let waNumberId = conversation.waNumberId;
  if (!waNumberId) {
    const waNumber = await prisma.waNumber.findFirst({
      where: { workspaceId: enrollment.workspaceId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!waNumber) throw new Error('No connected WhatsApp number to send from');
    await prisma.conversation.update({ where: { id: conversation.id }, data: { waNumberId: waNumber.id } });
    waNumberId = waNumber.id;
  }

  const outcome = await deliverAutomatedReply({
    conversationId: conversation.id,
    waNumberId,
    toPhone: contact.phoneNumber,
    body,
    recordFailure: true,
    reason: 'Sequence message',
  });
  if (!outcome.ok) throw new Error(`Not sent (${outcome.code}): ${outcome.detail}`);

  const wamid = outcome.message?.metaMessageId;
  return `Sent to ${contact.phoneNumber}${wamid ? ` (Meta ID: ${wamid})` : ''}`;
}
