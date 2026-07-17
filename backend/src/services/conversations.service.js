import { prisma } from '../lib/prisma.js';
import { decrypt } from '../lib/encryption.js';
import { sendTextMessage } from '../lib/meta.js';
import { consumeMessageCredit } from './subscription.service.js';

export async function listConversations(workspaceId, { page = 1, limit = 20 } = {}) {
  const skip = (page - 1) * limit;
  const [data, total] = await Promise.all([
    prisma.conversation.findMany({
      where: { workspaceId },
      skip,
      take: limit,
      orderBy: { lastMessageAt: 'desc' },
      include: {
        contact: { select: { id: true, name: true, phoneNumber: true } },
        messages: { orderBy: { sentAt: 'desc' }, take: 1 },
      },
    }),
    prisma.conversation.count({ where: { workspaceId } }),
  ]);
  return { data, total };
}

export async function getMessages(workspaceId, conversationId) {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, workspaceId },
  });
  if (!conversation) { const e = new Error('Conversation not found'); e.status = 404; throw e; }

  await prisma.conversation.update({ where: { id: conversationId }, data: { unreadCount: 0 } });

  return prisma.message.findMany({
    where: { conversationId },
    orderBy: { sentAt: 'asc' },
    include: { senderUser: { select: { id: true, name: true } } },
  });
}

export async function sendMessage(workspaceId, conversationId, userId, { type, body }) {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, workspaceId },
    include: { contact: true, waNumber: true },
  });
  if (!conversation) { const e = new Error('Conversation not found'); e.status = 404; throw e; }

  const credit = await consumeMessageCredit(workspaceId, { reason: 'Message overage' });
  if (!credit.ok) {
    const e = new Error('Message quota and wallet balance exhausted — recharge your wallet or upgrade your plan');
    e.status = 403;
    throw e;
  }

  const accessToken = decrypt(conversation.waNumber.encryptedAccessToken);
  const result = await sendTextMessage(
    conversation.waNumber.metaPhoneNumberId,
    accessToken,
    conversation.contact.phoneNumber,
    body
  );

  const message = await prisma.message.create({
    data: {
      conversationId,
      body,
      direction: 'OUTBOUND',
      metaMessageId: result?.messages?.[0]?.id,
      senderUserId: userId,
    },
    include: { senderUser: { select: { id: true, name: true } } },
  });

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { lastMessageAt: new Date() },
  });

  return message;
}
