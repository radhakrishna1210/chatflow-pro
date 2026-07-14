import { prisma } from '../lib/prisma.js';
import { findMatchingTrigger } from './automation.service.js';
import { matchIntent, generateAgentReply } from './aiAgent.service.js';
import { decrypt } from '../lib/encryption.js';
import { sendTextMessage } from '../lib/meta.js';
import { queueTemplateApprovedEmail, queueTemplateRejectedEmail } from './email.service.js';

const WELCOME_MESSAGE_GAP_MS = 24 * 60 * 60 * 1000;
const DEFAULT_WELCOME_MESSAGE = "Thanks for reaching out! We've received your message and will get back to you shortly.";
const DEFAULT_OOO_MESSAGE = "We're currently unavailable. We'll respond to your message as soon as possible.";

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
    data: { status: newStatus },
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

  // Meta sends bare digits ("919876543210"); contacts may be stored with
  // "+" / spaces. Match on normalized digits so imported contacts are found.
  const digits = String(fromPhone || '').replace(/[^\d]/g, '');
  let contact = await prisma.contact.findFirst({
    where: {
      workspaceId: waNumber.workspaceId,
      OR: [
        { phoneNumber: fromPhone },
        { phoneNumber: digits },
        { phoneNumber: `+${digits}` },
      ],
    },
  });
  if (!contact && digits) {
    // Last-resort fuzzy match: same trailing 10 digits within the workspace.
    const tail = digits.slice(-10);
    const candidates = await prisma.contact.findMany({
      where: { workspaceId: waNumber.workspaceId, phoneNumber: { contains: tail } },
      take: 5,
    });
    contact = candidates.find((c) => String(c.phoneNumber).replace(/[^\d]/g, '') === digits) || null;
  }
  const isNewContact = !contact;

  if (!contact) {
    const displayName = value.contacts?.[0]?.profile?.name || fromPhone;
    contact = await prisma.contact.create({
      data: { workspaceId: waNumber.workspaceId, name: displayName, phoneNumber: fromPhone },
    });
  }

  let conversation = await prisma.conversation.findFirst({
    where: { workspaceId: waNumber.workspaceId, contactId: contact.id, waNumberId: waNumber.id },
  });
  const wasClosed = conversation?.status === 'CLOSED';
  const previousLastMessageAt = conversation?.lastMessageAt ?? null;

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

  let autoReplyText = null;
  if (messageBody) {
    // 1. Exact / contains keyword trigger (highest priority, deterministic).
    const trigger = await findMatchingTrigger(waNumber.workspaceId, messageBody);
    if (trigger) autoReplyText = trigger.responseTemplate;

    // 2. AI Intent Matching — fuzzy-route to the best trigger when no exact
    //    match was found. Real feature, gated by intentMatchingEnabled.
    if (!autoReplyText) {
      const intent = await matchIntent(waNumber.workspaceId, messageBody).catch(() => null);
      if (intent?.trigger) autoReplyText = intent.trigger.responseTemplate;
    }
  }

  if (!autoReplyText) {
    const workspace = await prisma.workspace.findUnique({
      where: { id: waNumber.workspaceId },
      select: { autoWelcomeEnabled: true, autoOooEnabled: true },
    });
    const isReturningAfterGap = !isNewContact && previousLastMessageAt
      && (Date.now() - new Date(previousLastMessageAt).getTime()) > WELCOME_MESSAGE_GAP_MS;

    if (workspace?.autoWelcomeEnabled && (isNewContact || isReturningAfterGap)) {
      autoReplyText = DEFAULT_WELCOME_MESSAGE;
    } else if (workspace?.autoOooEnabled && wasClosed) {
      autoReplyText = DEFAULT_OOO_MESSAGE;
    }
  }

  // 3. AI Agent fallback — a deployed LLM agent answers free-form questions when
  //    nothing above matched. Only fires if explicitly deployed.
  if (!autoReplyText && messageBody) {
    autoReplyText = await generateAgentReply(waNumber.workspaceId, messageBody, {
      contactName: contact?.name,
    }).catch(() => null);
  }

  if (autoReplyText) {
    const accessToken = decrypt(waNumber.encryptedAccessToken);
    const result = await sendTextMessage(
      waNumber.metaPhoneNumberId,
      accessToken,
      fromPhone,
      autoReplyText
    ).catch(() => null);

    if (result) {
      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          body: autoReplyText,
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

async function handleStatusUpdate(status) {
  const metaMessageId = status.id;
  const newStatus = status.status;
  const eventTime = status.timestamp ? new Date(parseInt(status.timestamp, 10) * 1000) : new Date();

  // The campaign worker stores campaignRecipientId on each outbound message,
  // so a Meta status webhook maps 1:1 to the recipient it belongs to.
  const message = await prisma.message.findFirst({
    where: { metaMessageId },
    select: { id: true, campaignRecipientId: true },
  });
  if (!message || !message.campaignRecipientId) return;

  const recipient = await prisma.campaignRecipient.findUnique({
    where: { id: message.campaignRecipientId },
    select: { id: true, campaignId: true, status: true, deliveredAt: true, readAt: true, failedAt: true },
  });
  if (!recipient) return;

  if (newStatus === 'delivered' && !recipient.deliveredAt) {
    await prisma.$transaction([
      prisma.campaignRecipient.update({
        where: { id: recipient.id },
        data: { deliveredAt: eventTime, ...(recipient.status === 'SENT' ? { status: 'DELIVERED' } : {}) },
      }),
      prisma.campaign.update({
        where: { id: recipient.campaignId },
        data: { delivered: { increment: 1 } },
      }),
    ]);
  } else if (newStatus === 'read' && !recipient.readAt) {
    const ops = [
      prisma.campaignRecipient.update({
        where: { id: recipient.id },
        data: {
          readAt: eventTime,
          status: 'READ',
          // A read implies delivery — backfill if the delivered webhook was missed.
          ...(recipient.deliveredAt ? {} : { deliveredAt: eventTime }),
        },
      }),
      prisma.campaign.update({
        where: { id: recipient.campaignId },
        data: {
          read: { increment: 1 },
          ...(recipient.deliveredAt ? {} : { delivered: { increment: 1 } }),
        },
      }),
    ];
    await prisma.$transaction(ops);
  } else if (newStatus === 'failed' && !recipient.failedAt) {
    const reason = status.errors?.[0]?.title || status.errors?.[0]?.message || 'Delivery failed';
    await prisma.$transaction([
      prisma.campaignRecipient.update({
        where: { id: recipient.id },
        data: { failedAt: eventTime, status: 'FAILED', failReason: reason },
      }),
      prisma.campaign.update({
        where: { id: recipient.campaignId },
        data: { failed: { increment: 1 } },
      }),
    ]);
  }
}
