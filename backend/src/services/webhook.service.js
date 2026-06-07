import { prisma } from '../lib/prisma.js';
import { findMatchingTrigger } from './automation.service.js';
import { decrypt } from '../lib/encryption.js';
import { sendTextMessage } from '../lib/meta.js';
import { queueTemplateApprovedEmail, queueTemplateRejectedEmail } from './email.service.js';

export async function processWebhook(body) {
  const entries = body?.entry || [];

  for (const entry of entries) {
    for (const change of entry.changes || []) {
      const value = change.value;
      if (!value) continue;

      if (change.field === 'message_template_status_update') {
        await handleTemplateStatusUpdate(entry.id, value);
        continue;
      }

      if (value.messages) {
        for (const msg of value.messages) {
          await handleInboundMessage(value, msg);
        }
      }

      if (value.statuses) {
        for (const status of value.statuses) {
          await handleStatusUpdate(status);
        }
      }
    }
  }
}

function mapMetaTemplateEvent(event) {
  if (event === 'APPROVED') return 'APPROVED';
  if (event === 'REJECTED' || event === 'DISABLED' || event === 'FLAGGED' || event === 'PAUSED') return 'REJECTED';
  return 'PENDING';
}

async function handleTemplateStatusUpdate(wabaId, value) {
  const metaTemplateId = value.message_template_id ? String(value.message_template_id) : null;
  const templateName   = value.message_template_name;
  const templateLang   = value.message_template_language;
  const event          = value.event;
  const newStatus      = mapMetaTemplateEvent(event);

  console.log(`[Template] WABA=${wabaId} id=${metaTemplateId} name="${templateName}" event=${event} → ${newStatus}`);

  // Find affected templates. Prefer metaTemplateId, fall back to name+language scoped to the WABA's workspaces.
  let where;
  if (metaTemplateId) {
    where = { metaTemplateId };
  } else if (templateName) {
    const waNumbers = await prisma.waNumber.findMany({ where: { wabaId }, select: { workspaceId: true } });
    const wsIds = [...new Set(waNumbers.map((n) => n.workspaceId))];
    if (wsIds.length === 0) {
      console.warn(`[Template] No workspace owns WABA ${wabaId} — dropping update.`);
      return;
    }
    where = { workspaceId: { in: wsIds }, name: templateName, language: templateLang };
  } else {
    console.warn('[Template] update lacked id and name — ignoring.');
    return;
  }

  const result = await prisma.template.updateMany({
    where,
    data: { status: newStatus, ...(metaTemplateId ? {} : { metaTemplateId: undefined }) },
  });
  console.log(`[Template] Updated ${result.count} row(s) to ${newStatus}.`);

  if (result.count > 0 && templateName) {
    const affectedTemplates = await prisma.template.findMany({ where, select: { workspaceId: true, name: true } });
    const seen = new Set();
    for (const t of affectedTemplates) {
      if (seen.has(t.workspaceId)) continue;
      seen.add(t.workspaceId);
      if (newStatus === 'APPROVED') {
        queueTemplateApprovedEmail(t.workspaceId, t.name).catch(() => {});
      } else if (newStatus === 'REJECTED') {
        queueTemplateRejectedEmail(t.workspaceId, t.name).catch(() => {});
      }
    }
  }
}

async function handleInboundMessage(value, msg) {
  const phoneNumberId = value.metadata?.phone_number_id;
  const fromPhone = msg.from;
  const messageBody = msg.text?.body || '';

  console.log(`[Inbound] from=${fromPhone} phone_number_id=${phoneNumberId} body="${messageBody}"`);

  const waNumber = await prisma.waNumber.findFirst({ where: { metaPhoneNumberId: phoneNumberId } });
  if (!waNumber) {
    console.warn(`[Inbound] DROPPED — no WaNumber row found for metaPhoneNumberId=${phoneNumberId}. Add the number via the WhatsApp setup screen in the app so this ID is saved.`);
    return;
  }
  console.log(`[Inbound] matched waNumber id=${waNumber.id} workspace=${waNumber.workspaceId} — writing message to DB`);

  let contact = await prisma.contact.findFirst({
    where: { workspaceId: waNumber.workspaceId, phoneNumber: fromPhone },
  });

  if (!contact) {
    const displayName = value.contacts?.[0]?.profile?.name || fromPhone;
    contact = await prisma.contact.create({
      data: { workspaceId: waNumber.workspaceId, name: displayName, phoneNumber: fromPhone },
    });
  }

  let conversation = await prisma.conversation.findFirst({
    where: { workspaceId: waNumber.workspaceId, contactId: contact.id, waNumberId: waNumber.id },
  });

  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: {
        workspaceId: waNumber.workspaceId,
        contactId: contact.id,
        waNumberId: waNumber.id,
        status: 'OPEN',
      },
    });
  }

  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      body: messageBody,
      direction: 'INBOUND',
      metaMessageId: msg.id,
      sentAt: new Date(parseInt(msg.timestamp) * 1000),
    },
  });

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { unreadCount: { increment: 1 }, lastMessageAt: new Date() },
  });

  if (messageBody) {
    const trigger = await findMatchingTrigger(waNumber.workspaceId, messageBody);
    if (trigger) {
      const accessToken = decrypt(waNumber.encryptedAccessToken);
      const result = await sendTextMessage(
        waNumber.metaPhoneNumberId,
        accessToken,
        fromPhone,
        trigger.responseTemplate
      ).catch(() => null);

      if (result) {
        await prisma.message.create({
          data: {
            conversationId: conversation.id,
            body: trigger.responseTemplate,
            direction: 'OUTBOUND',
            metaMessageId: result?.messages?.[0]?.id,
            sentAt: new Date(),
          },
        });
        await prisma.conversation.update({
          where: { id: conversation.id },
          data: { lastMessageAt: new Date() },
        });
      }
    }
  }
}

async function handleStatusUpdate(status) {
  const metaMessageId = status.id;
  const newStatus = status.status;

  const message = await prisma.message.findFirst({ where: { metaMessageId } });
  if (!message) return;

  const recipient = await prisma.campaignRecipient.findFirst({
    where: { campaign: { recipients: { some: {} } } },
  });

  const now = new Date();
  const updateData = {};

  if (newStatus === 'delivered') {
    updateData.deliveredAt = now;
    updateData.status = 'DELIVERED';
    await prisma.campaignRecipient.updateMany({
      where: { campaign: { workspaceId: { not: undefined } } },
      data: {},
    });

    const conv = await prisma.conversation.findFirst({ where: { id: message.conversationId } });
    if (conv) {
      await prisma.campaign.updateMany({
        where: { workspaceId: conv.workspaceId, status: 'RUNNING' },
        data: { delivered: { increment: 1 } },
      });
    }
  } else if (newStatus === 'read') {
    const conv = await prisma.conversation.findFirst({ where: { id: message.conversationId } });
    if (conv) {
      await prisma.campaign.updateMany({
        where: { workspaceId: conv.workspaceId, status: 'RUNNING' },
        data: { read: { increment: 1 } },
      });
    }
  } else if (newStatus === 'failed') {
    const conv = await prisma.conversation.findFirst({ where: { id: message.conversationId } });
    if (conv) {
      await prisma.campaign.updateMany({
        where: { workspaceId: conv.workspaceId, status: 'RUNNING' },
        data: { failed: { increment: 1 } },
      });
    }
  }
}
