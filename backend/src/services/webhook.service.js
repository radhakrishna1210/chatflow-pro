import { prisma } from '../lib/prisma.js';
import { findMatchingTrigger } from './automation.service.js';
import { matchIntent, generateAgentReply } from './aiAgent.service.js';
import { handleCampaignAiInbound } from './campaignAi.service.js';
import { queueTemplateApprovedEmail, queueTemplateRejectedEmail } from './email.service.js';
import { handleRecipientFailure } from './retry.service.js';
import { sendAutomatedReply } from './outbound.service.js';
import { runWorkflowsForInbound, runWillSendMessage } from './workflowEngine.service.js';
import { handleFormInbound } from './whatsappForms.service.js';
import { MESSAGE_CATEGORY_RATES } from '../lib/messagePricing.js';
import { isWithinBusinessHours } from './businessHours.service.js';
import { matchOptOutKeyword, recordOptOut } from './optout.service.js';
import { notifyWorkspace } from './notification.service.js';

const WELCOME_MESSAGE_GAP_MS = 24 * 60 * 60 * 1000;

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

      // Meta re-reviews approved templates and can move them between
      // categories. Nothing consumed this before, so the stored category went
      // stale and campaigns kept quoting the old per-message price.
      if (change.field === 'message_template_category_update') {
        await handleTemplateCategoryUpdate(entry.id, value);
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
  // Deleted on Meta — tombstone it so it drops out of the app immediately
  // instead of falling through to PENDING and reappearing as "in review".
  if (event === 'DELETED' || event === 'PENDING_DELETION') return 'DELETED';
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
        notifyWorkspace(t.workspaceId, {
          type: 'TEMPLATE_APPROVED',
          title: `Template "${t.name}" was approved`,
          body: 'It can now be used in campaigns.',
          link: 'templates',
        }).catch(() => {});
      } else if (newStatus === 'REJECTED') {
        queueTemplateRejectedEmail(t.workspaceId, t.name).catch(() => {});
        notifyWorkspace(t.workspaceId, {
          type: 'TEMPLATE_REJECTED',
          title: `Template "${t.name}" was rejected`,
          body: 'Meta rejected this template. Edit it and resubmit for review.',
          link: 'templates',
        }).catch(() => {});
      }
    }
  }
}

// Imported rather than re-declared: a second copy of the per-category prices
// would drift from the ones campaigns are actually billed at.
const CATEGORY_RATES = MESSAGE_CATEGORY_RATES;

// Meta moved a template to a different category. Records the change and warns
// the workspace when it costs them more, since the per-message price is set by
// the category (lib/messagePricing.js).
async function handleTemplateCategoryUpdate(wabaId, value) {
  const metaTemplateId = value.message_template_id ? String(value.message_template_id) : null;
  const templateName = value.message_template_name;
  const templateLang = value.message_template_language;
  const previous = String(value.previous_category || '').toUpperCase() || null;
  const next = String(value.new_category || '').toUpperCase();

  if (!next || !CATEGORY_RATES[next]) {
    console.warn(`[Template] category update with unusable new_category "${value.new_category}" — ignoring.`);
    return;
  }

  // Same resolution order as the status handler: id first, then name+language
  // scoped to whichever workspaces own this WABA.
  let where;
  if (metaTemplateId) {
    where = { metaTemplateId };
  } else if (templateName) {
    const waNumbers = await prisma.waNumber.findMany({ where: { wabaId }, select: { workspaceId: true } });
    const wsIds = [...new Set(waNumbers.map((n) => n.workspaceId))];
    if (wsIds.length === 0) {
      console.warn(`[Template] No workspace owns WABA ${wabaId} — dropping category update.`);
      return;
    }
    where = { workspaceId: { in: wsIds }, name: templateName, language: templateLang };
  } else {
    console.warn('[Template] category update lacked id and name — ignoring.');
    return;
  }

  const affected = await prisma.template.findMany({ where, select: { id: true, workspaceId: true, name: true, category: true } });
  if (affected.length === 0) {
    console.warn(`[Template] category update matched no local template (name="${templateName}").`);
    return;
  }

  await prisma.template.updateMany({
    where,
    data: {
      category: next,
      // Prefer Meta's stated previous category; fall back to what we had.
      previousCategory: previous || affected[0].category || null,
      categoryUpdatedAt: new Date(),
    },
  });
  console.log(`[Template] Re-categorised ${affected.length} row(s): ${previous || affected[0].category} -> ${next}`);

  const before = CATEGORY_RATES[previous || affected[0].category] ?? null;
  const after = CATEGORY_RATES[next];
  const dearer = before != null && after > before;

  const seen = new Set();
  for (const t of affected) {
    if (seen.has(t.workspaceId)) continue;
    seen.add(t.workspaceId);
    notifyWorkspace(t.workspaceId, {
      type: 'TEMPLATE_RECATEGORISED',
      title: `Meta moved "${t.name}" to ${next}`,
      body: dearer
        ? `Each message now costs \u20b9${after.toFixed(2)} instead of \u20b9${before.toFixed(2)}. Open the template to generate a utility-compliant rewrite.`
        : `This template is now billed as ${next} at \u20b9${after.toFixed(2)} per message.`,
      link: 'templates',
      meta: { templateId: t.id, previousCategory: previous || t.category, newCategory: next },
    }).catch(() => {});
  }
}

async function handleInboundMessage(value, msg) {
  const phoneNumberId = value.metadata?.phone_number_id;
  const fromPhone = msg.from;
  let messageBody = '';
  if (msg.text?.body) {
    messageBody = msg.text.body;
  } else if (msg.button?.text) {
    messageBody = msg.button.text;
  } else if (msg.interactive?.button_reply?.title) {
    messageBody = msg.interactive.button_reply.title;
  } else if (msg.interactive?.list_reply?.title) {
    messageBody = msg.interactive.list_reply.title;
  }

  // Tapping a template quick-reply delivers the payload the send attached to
  // that button (msg.button.payload); an interactive reply carries it as the
  // reply's id. Campaigns stamp the recipient's id there, so a CTA tap names
  // the exact campaign message the customer is looking at.
  const buttonPayload = msg.button?.payload
    ?? msg.interactive?.button_reply?.id
    ?? msg.interactive?.list_reply?.id
    ?? null;

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

  const workspaceId = waNumber.workspaceId;

  // 0. Opt-out beats everything. A STOP (or any accepted opt-out keyword)
  //    blocks the number for good and stops this message from triggering any
  //    automation — replying to someone who just asked to be left alone is
  //    exactly what opting out is supposed to prevent. Matching ignores case,
  //    surrounding spaces and punctuation, so "STOP", " stop ", "Stop." and
  //    "STOP!" all land here. Repeat STOPs are idempotent.
  const optOutKeyword = matchOptOutKeyword(messageBody);
  if (optOutKeyword) {
    try {
      await recordOptOut({
        workspaceId,
        phoneNumber: fromPhone,
        waNumberId: waNumber.id,
        waPhone: waNumber.phoneNumber,
        contactId: contact.id,
        keyword: optOutKeyword,
        reason: 'User Opted Out',
        source: 'Incoming WhatsApp Message',
      });
      console.log(`[Inbound] ${fromPhone} opted out of workspace ${workspaceId} via "${optOutKeyword}"`);
      await notifyWorkspace(workspaceId, {
        type: 'OPT_OUT',
        title: 'A contact opted out',
        body: `${contact.name || fromPhone} sent "${optOutKeyword}" and will no longer receive messages.`,
        link: 'settings',
        meta: { phoneNumber: fromPhone, keyword: optOutKeyword },
      }).catch(() => {});
    } catch (err) {
      console.error('[Inbound] Could not record opt-out:', err.message);
    }
    return;
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      autoWelcomeEnabled: true,
      autoOooEnabled: true,
      autoDelayedEnabled: true,
      welcomeMessage: true,
      oooMessage: true,
      delayedAfterMinutes: true,
      businessHours: true,
    },
  });

  // 0. Campaign AI Agent. A customer who tapped a campaign's "Ask Anything"
  //    CTA is in a conversation *about that campaign*, and every message until
  //    the session expires belongs to the agent that was attached to it.
  //    Ahead of everything else on purpose: the generic fallback agent (step 5)
  //    would otherwise answer campaign questions with no campaign in front of
  //    it, and a keyword trigger would talk over a live chat. Returns false
  //    unless a CTA was tapped or a session is live, so nothing changes for
  //    workspaces that don't use the feature.
  const consumedByCampaignAi = await handleCampaignAiInbound({
    workspaceId,
    conversation,
    contact,
    messageBody,
    buttonPayload,
  }).catch((err) => {
    console.error('[Inbound] Campaign AI handling failed:', err);
    return false;
  });
  if (consumedByCampaignAi) {
    await scheduleDelayedResponse(workspace, conversation.id);
    return;
  }

  // 0. A form in progress owns the conversation until it finishes — the
  //    customer is answering a question, not starting a new automation.
  const consumedByForm = await handleFormInbound({
    workspaceId,
    conversation,
    contact,
    messageBody,
  }).catch((err) => {
    console.error('[Inbound] Form handling failed:', err);
    return false;
  });
  if (consumedByForm) {
    await scheduleDelayedResponse(workspace, conversation.id);
    return;
  }

  // 1. Workflows. Previously the Workflows tab saved rows that nothing ever
  //    read; the engine now runs the matching workflow's steps for real.
  let workflowWillReply = false;
  try {
    const runs = await runWorkflowsForInbound(workspaceId, {
      event: 'message',
      messageBody,
      isNewContact,
      conversationId: conversation.id,
      contactId: contact.id,
    });
    workflowWillReply = runs.some(runWillSendMessage);
  } catch (err) {
    console.error('[Inbound] Workflow execution failed:', err);
  }

  let autoReplyText = null;

  // 2. Exact keyword trigger (deterministic, highest priority after workflows).
  if (messageBody && !workflowWillReply) {
    const trigger = await findMatchingTrigger(workspaceId, messageBody);
    if (trigger) autoReplyText = trigger.responseTemplate;

    // 3. AI Intent Matching — fuzzy-route to the best trigger when no exact
    //    match was found. Real feature, gated by intentMatchingEnabled.
    if (!autoReplyText) {
      const intent = await matchIntent(workspaceId, messageBody).catch(() => null);
      if (intent?.trigger) autoReplyText = intent.trigger.responseTemplate;
    }
  }

  // 4. Welcome / out-of-office. Both messages are workspace-configurable now,
  //    and OOO additionally fires outside working hours — which is what the UI
  //    has always claimed it did.
  if (!autoReplyText && !workflowWillReply) {
    const isReturningAfterGap = !isNewContact && previousLastMessageAt
      && (Date.now() - new Date(previousLastMessageAt).getTime()) > WELCOME_MESSAGE_GAP_MS;
    const closedNow = !isWithinBusinessHours(workspace?.businessHours);

    if (workspace?.autoWelcomeEnabled && (isNewContact || isReturningAfterGap)) {
      autoReplyText = workspace.welcomeMessage;
    } else if (workspace?.autoOooEnabled && (wasClosed || closedNow)) {
      autoReplyText = workspace.oooMessage;
    }
  }

  // 5. AI Agent fallback — a deployed LLM agent answers free-form questions when
  //    nothing above matched. Only fires if explicitly deployed.
  //
  //    The conversation and the number are passed so the agent can read the
  //    thread so far, name the business it answers for, and pick up the
  //    campaign this conversation was about if there was one. Without them it
  //    answered every message in isolation and offered a human whenever the
  //    knowledge base fell short.
  if (!autoReplyText && !workflowWillReply && messageBody) {
    autoReplyText = await generateAgentReply(workspaceId, messageBody, {
      contactName: contact?.name,
      conversationId: conversation.id,
      waNumberId: waNumber.id,
    }).catch(() => null);
  }

  if (autoReplyText) {
    await sendAutomatedReply({
      conversationId: conversation.id,
      waNumberId: waNumber.id,
      toPhone: fromPhone,
      body: autoReplyText,
    });
  }

  await scheduleDelayedResponse(workspace, conversation.id);
}

// Arms the "Delayed Response Message" automation. The worker re-checks at fire
// time whether anyone replied, so scheduling here is harmless when the team is
// responsive — and the queue's jobId keeps one pending check per conversation.
async function scheduleDelayedResponse(workspace, conversationId) {
  if (!workspace?.autoDelayedEnabled) return;
  const minutes = Math.max(1, workspace.delayedAfterMinutes || 15);
  try {
    const { enqueueDelayedResponseCheck } = await import('../queues/workflow.queue.js');
    await enqueueDelayedResponseCheck(conversationId, minutes * 60_000);
  } catch (err) {
    // Redis being down must never cost us the inbound message itself.
    console.error('[Inbound] Could not schedule delayed-response check:', err.message);
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
    select: { id: true, campaignId: true, contactId: true, retryCount: true, status: true, deliveredAt: true, readAt: true, failedAt: true },
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
    const errObj = status.errors?.[0];
    const code = errObj?.code;
    const reason = errObj ? `${errObj.title || errObj.message || 'Delivery failed'}${code ? ` (code ${code})` : ''}` : 'Delivery failed';

    const campaign = await prisma.campaign.findUnique({
      where: { id: recipient.campaignId },
    });
    if (campaign) {
      const contact = await prisma.contact.findUnique({ where: { id: recipient.contactId } }).catch(() => null);
      await handleRecipientFailure(campaign, { ...recipient, contact }, reason, code);
    }
  }
}
