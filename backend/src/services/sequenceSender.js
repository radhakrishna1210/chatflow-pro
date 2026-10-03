import { prisma } from '../lib/prisma.js';
import { deliverAutomatedReply } from './outbound.service.js';
import { renderTemplate, tidy } from './workflowConditions.js';

// Sends one sequence message. Kept out of the engine so the engine stays free
// of provider concerns and testable without a live number.
//
// Messages are written into the contact's WhatsApp conversation so a sequence
// message and a human reply sit in one thread, which is what makes
// exit-on-reply meaningful.
//
// Two kinds of step send:
//  - MESSAGE: free-form text through deliverAutomatedReply like every other
//    automated send — metered against quota/wallet, honours the OptOut list
//    and the 24-hour window, and stores a real Message row.
//  - TEMPLATE: an approved template through conversations.sendTemplateMessage
//    (the same send as the inbox), the only thing WhatsApp accepts after the
//    window has closed or for a contact who has never written in.
//
// A send that does not happen throws. Errors carry a `code` the engine acts
// on (sequenceEngine.service.js#handleSendRefusal): WINDOW_CLOSED fails the
// step and moves on, NO_CREDIT pauses the enrollment, OPTED_OUT and
// INSTAGRAM_ONLY exit it. Any other error fails the enrollment.

export function sequenceSendError(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

const CONTACT_SELECT = {
  id: true, name: true, phoneNumber: true, email: true, optedOut: true, tags: true, customFields: true,
};

// The contact's WhatsApp thread. Never an Instagram one: a WhatsApp number
// written onto an Instagram conversation routed every later reply on that
// thread to WhatsApp.
function findWhatsAppConversation(workspaceId, contactId) {
  return prisma.conversation.findFirst({
    where: { workspaceId, contactId, channel: 'WHATSAPP' },
    orderBy: { lastMessageAt: 'desc' },
    select: { id: true, waNumberId: true },
  });
}

async function activeNumberId(workspaceId) {
  const waNumber = await prisma.waNumber.findFirst({
    where: { workspaceId, status: 'ACTIVE' },
    select: { id: true },
  });
  if (!waNumber) throw sequenceSendError('NO_NUMBER', 'No connected WhatsApp number to send from');
  return waNumber.id;
}

// A WhatsApp conversation with a number attached, for a template send. A
// contact who has never written in has none yet; one is opened, the same way
// the inbox does when an agent starts a conversation.
async function ensureWhatsAppConversation(workspaceId, contactId) {
  let conversation = await findWhatsAppConversation(workspaceId, contactId);
  if (conversation?.waNumberId) return conversation;

  const waNumberId = await activeNumberId(workspaceId);
  if (conversation) {
    await prisma.conversation.update({ where: { id: conversation.id }, data: { waNumberId } });
    return { ...conversation, waNumberId };
  }
  try {
    conversation = await prisma.conversation.create({
      data: { workspaceId, contactId, waNumberId, channel: 'WHATSAPP', status: 'OPEN' },
      select: { id: true, waNumberId: true },
    });
  } catch (err) {
    // A concurrent send or an inbound message opened it first.
    conversation = await findWhatsAppConversation(workspaceId, contactId);
    if (!conversation) throw err;
  }
  return conversation;
}

// Turns a template send's thrown error into the codes the engine acts on.
function classifyTemplateError(err) {
  const code = String(err?.code ?? '');
  const message = err?.message || 'The template could not be sent';
  if (code === 'RECIPIENT_OPTED_OUT' || code === 'OPTED_OUT') return sequenceSendError('OPTED_OUT', message);
  if (code === 'NO_CREDIT' || code === 'QUOTA_AND_WALLET_EXHAUSTED' || code === 'SUBSCRIPTION_INACTIVE'
    || (err?.status === 403 && /quota|wallet|subscription/i.test(message))) {
    return sequenceSendError('NO_CREDIT', message);
  }
  if (code === 'TEMPLATE_NOT_SENDABLE' || /template not found/i.test(message)) {
    return sequenceSendError('TEMPLATE_UNAVAILABLE', message);
  }
  return err instanceof Error ? err : new Error(message);
}

async function sendTemplateStep({ enrollment, step, contact }) {
  const conversation = await ensureWhatsAppConversation(enrollment.workspaceId, contact.id);

  // Parameters fill {{1}}, {{2}}, ... in order, and may themselves use the
  // same tokens as a workflow message: {{name}}, {{custom.city}}, ...
  const variables = (Array.isArray(step.params) ? step.params : [])
    .map((p) => tidy(renderTemplate(p, { contact })));

  const { sendTemplateMessage } = await import('./conversations.service.js');
  let message;
  try {
    message = await sendTemplateMessage(enrollment.workspaceId, conversation.id, null, {
      templateId: step.templateId,
      variables,
      contactId: contact.id,
    });
  } catch (err) {
    throw classifyTemplateError(err);
  }
  const wamid = message?.metaMessageId;
  return `Template ${step.templateName ? `"${step.templateName}" ` : ''}sent to ${contact.phoneNumber}${wamid ? ` (Meta ID: ${wamid})` : ''}`;
}

async function sendMessageStep({ enrollment, body, contact }) {
  const conversation = await findWhatsAppConversation(enrollment.workspaceId, contact.id);
  // A contact with no WhatsApp conversation has never written in, so there is
  // no window to send free-form text into.
  if (!conversation) {
    throw sequenceSendError('WINDOW_CLOSED',
      'The contact has never messaged this workspace on WhatsApp, so a free-form message cannot be sent — use a template step');
  }

  let waNumberId = conversation.waNumberId;
  if (!waNumberId) {
    waNumberId = await activeNumberId(enrollment.workspaceId);
    await prisma.conversation.update({ where: { id: conversation.id }, data: { waNumberId } });
  }

  const text = tidy(renderTemplate(body, { contact }));
  const outcome = await deliverAutomatedReply({
    conversationId: conversation.id,
    waNumberId,
    toPhone: contact.phoneNumber,
    body: text,
    recordFailure: true,
    reason: 'Sequence message',
  });
  if (!outcome.ok) {
    const detail = outcome.code === 'WINDOW_CLOSED'
      ? `${outcome.detail} — use a template step for messages after a long wait`
      : outcome.detail;
    throw sequenceSendError(outcome.code, `Not sent (${outcome.code}): ${detail}`);
  }

  const wamid = outcome.message?.metaMessageId;
  return `Sent to ${contact.phoneNumber}${wamid ? ` (Meta ID: ${wamid})` : ''}`;
}

export async function sendSequenceMessage({ enrollment, step, body }) {
  const kind = step?.kind ?? 'MESSAGE';
  const contact = await prisma.contact.findUnique({ where: { id: enrollment.contactId }, select: CONTACT_SELECT });
  if (!contact) throw new Error('Contact no longer exists');
  if (contact.optedOut) throw sequenceSendError('OPTED_OUT', 'Contact opted out');
  if (String(contact.phoneNumber ?? '').startsWith('ig:')) {
    throw sequenceSendError('INSTAGRAM_ONLY', 'This contact is only reachable on Instagram; sequences send on WhatsApp');
  }

  return kind === 'TEMPLATE'
    ? sendTemplateStep({ enrollment, step, contact })
    : sendMessageStep({ enrollment, body: body ?? step?.body, contact });
}
