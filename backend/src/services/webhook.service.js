import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { findMatchingTrigger } from './automation.service.js';
import { matchIntent, generateAgentReply } from './aiAgent.service.js';
import { handleCampaignAiInbound, parseCampaignCtaPayload } from './campaignAi.service.js';
import { queueTemplateApprovedEmail, queueTemplateRejectedEmail } from './email.service.js';
import { handleRecipientFailure } from './retry.service.js';
import { sendAutomatedReply } from './outbound.service.js';
import {
  runWorkflowsForInbound, runWillSendMessage, cancelActiveRuns, hasActiveRun, resumeAwaitingRun,
  findMatchingWorkflows, REPLY_TIMEOUT_MS,
} from './workflowEngine.service.js';
import { handleFormInbound, cancelOpenSubmission, hasOpenSubmission } from './whatsappForms.service.js';
import { MESSAGE_CATEGORY_RATES } from '../lib/messagePricing.js';
import { isWithinBusinessHours, describeBusinessHours } from './businessHours.service.js';
import {
  matchOptOutKeyword, recordOptOut, matchOptInKeyword, recordOptIn, isOptedOut, OPT_IN_CONFIRMATION,
} from './optout.service.js';
import { captureReplyAsLead } from './campaignLeads.service.js';
import { toE164 } from '../lib/phone.js';
import { llmAvailable } from '../lib/llm.js';
import { notifyWorkspace } from './notification.service.js';
import {
  parseInboundMessage, carriesCustomerText, mediaTypeOf, isButtonReply, inboundEvent,
} from './inboundMessage.js';
import { processInboundMedia } from './inboundMedia.service.js';
import { emitWebhook } from './outgoingWebhook.service.js';
import {
  routeByIntent, escalateToHuman, escalationMatch, escalationRulesApply,
} from './intentRouting.service.js';
import { planAllows } from './planFeatures.service.js';
import {
  detectControlCommand, interruptsFlow, detectGeneralIntent, CONTROL_REPLIES, normalise,
} from './conversationControl.service.js';
import { resolveHandoff, HANDOFF_REASONS } from './automationPause.service.js';
import { recordSuppressedAutomation, SUPPRESSION_REASONS } from './automationSuppression.service.js';
import { realtime } from '../lib/realtimeBus.js';

const WELCOME_MESSAGE_GAP_MS = 24 * 60 * 60 * 1000;

// A BullMQ retry (or Meta redelivery) that finds the message already stored
// but its automation unfinished picks the automation up again — within this
// window. Past it the moment has gone: a reply an hour late to "hi" is worse
// than none (WF-IN-12).
const AUTOMATION_RESUME_WINDOW_MS = 60 * 60_000;

// The statuses a message may move to each status from (see handleStatusUpdate).
const MESSAGE_STATUS_FROM = {
  SENT: ['PENDING'],
  DELIVERED: ['PENDING', 'SENT'],
  READ: ['PENDING', 'SENT', 'DELIVERED'],
  FAILED: ['PENDING', 'SENT', 'DELIVERED'],
};

// A failure of the database itself (connection, timeout, constraint), as
// opposed to a bug in the query or the code around it.
function isPrismaError(err) {
  return err instanceof Prisma.PrismaClientKnownRequestError
    || err instanceof Prisma.PrismaClientUnknownRequestError
    || err instanceof Prisma.PrismaClientInitializationError;
}

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
  if (result.count > 0) {
    prisma.template.findMany({ where, select: { id: true, workspaceId: true } })
      .then((rows) => rows.forEach((t) => realtime.templateUpdated(t.workspaceId, t.id, { status: newStatus })))
      .catch((err) => console.warn('[Template] Could not announce the status change to open screens:', err.message));
  }

  if (result.count > 0 && templateName) {
    const affectedTemplates = await prisma.template.findMany({ where, select: { workspaceId: true, name: true } });
    const seen = new Set();
    for (const t of affectedTemplates) {
      if (seen.has(t.workspaceId)) continue;
      seen.add(t.workspaceId);
      emitWebhook(t.workspaceId, 'template.status', { name: t.name, status: newStatus, event });
      if (newStatus === 'APPROVED') {
        queueTemplateApprovedEmail(t.workspaceId, t.name).catch((err) => console.warn('[Inbound] Template-approved email could not be queued:', err.message));
        notifyWorkspace(t.workspaceId, {
          type: 'TEMPLATE_APPROVED',
          title: `Template "${t.name}" was approved`,
          body: 'It can now be used in campaigns.',
          link: 'templates',
        }).catch((err) => console.warn('[Inbound] Template-approved notification failed:', err.message));
      } else if (newStatus === 'REJECTED') {
        queueTemplateRejectedEmail(t.workspaceId, t.name).catch((err) => console.warn('[Inbound] Template-rejected email could not be queued:', err.message));
        notifyWorkspace(t.workspaceId, {
          type: 'TEMPLATE_REJECTED',
          title: `Template "${t.name}" was rejected`,
          body: 'Meta rejected this template. Edit it and resubmit for review.',
          link: 'templates',
        }).catch((err) => console.warn('[Inbound] Template-rejected notification failed:', err.message));
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
  affected.forEach((t) => realtime.templateUpdated(t.workspaceId, t.id));

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
    }).catch((err) => console.warn(`[Inbound] Category-change notification failed for ${t.id}:`, err.message));
  }
}

// Routing order for an inbound customer message.
//
// Several subsystems can each claim to own the same message — a keyword
// trigger, a workflow, an intent rule and the AI agent will all happily answer
// "hi" — and when the order between them was implicit, a generic message got
// answered by whichever one happened to run first (QA BUG-05). The order below
// is the contract; anything added later has to be given a place in it.
//
//   1. Opt-in               — START/SUBSCRIBE from an opted-out contact.
//   2. Opt-out              — STOP/UNSUBSCRIBE typed as the whole message. With
//                             a form or workflow open it ends that flow first.
//   3. Human handoff        — a person has the thread; automation stays out
//                             until HANDOFF_TTL_HOURS pass without them
//                             replying, or the thread is closed and reopened.
//   4. Control commands     — explicit phrases ("talk to a human", "stop
//                             this") always; bare words ("agent", "cancel")
//                             only while a form or a parked run is open, and
//                             never as the answer a workflow is waiting for.
//   5. Campaign AI session  — a live conversation about a specific campaign.
//   6. Form in flight       — the customer is answering a question we asked.
//   7. Workflows            — a run waiting on this customer takes the reply
//                             first; otherwise a workflow trigger matched.
//   8. Exact keyword trigger
//   9. Intent rules         — the Intent Matching screen's rules.
//  10. Fuzzy keyword trigger
//  11. Escalation rules     — the AI agent's "hand this to a person" rules,
//                             only while an agent is deployed.
//  12. Welcome / out-of-office
//  13. General conversation — greeting, goodbye, thanks, working hours.
//  14. AI agent             — when it has nothing to say the message is left
//                             for the inbox; the contact is not handed off.
//
// Earlier layers are more deterministic and more specific; the model only sees
// what nothing above it claimed. A layer that keeps a message from a workflow
// that would have matched it records why in that workflow's run history
// (automationSuppression.service.js).
async function handleInboundMessage(value, msg) {
  const phoneNumberId = value.metadata?.phone_number_id;
  const fromPhone = msg.from;

  // Every inbound shape Meta sends, not just the four that used to be handled
  // (see services/inboundMessage.js). Media, location and contact cards were
  // previously stored as an empty body with no trace of the attachment.
  let parsed;
  try {
    parsed = parseInboundMessage(msg);
  } catch (err) {
    console.error(`[Inbound] PARSE FAILED — message ${msg?.id} (type=${msg?.type}) from=${fromPhone}: ${err.message}`);
    return;
  }
  // Reassigned once, when a voice note is transcribed (below).
  let messageBody = parsed.body;

  // Tapping a template quick-reply delivers the payload the send attached to
  // that button (msg.button.payload); an interactive reply carries it as the
  // reply's id. Campaigns stamp the recipient's id there, so a CTA tap names
  // the exact campaign message the customer is looking at.
  const buttonPayload = parsed.buttonPayload;

  console.log(`[Inbound] from=${fromPhone} phone_number_id=${phoneNumberId} type=${parsed.type} body="${messageBody}"`);

  const waNumber = await prisma.waNumber.findFirst({ where: { metaPhoneNumberId: phoneNumberId } });
  if (!waNumber) {
    console.warn(`[Inbound] DROPPED — no WaNumber row found for metaPhoneNumberId=${phoneNumberId}. Add the number via the WhatsApp setup screen in the app so this ID is saved.`);
    return;
  }
  console.log(`[Inbound] matched waNumber id=${waNumber.id} workspace=${waNumber.workspaceId} — writing message to DB`);

  const workspaceId = waNumber.workspaceId;
  const digits = String(fromPhone || '').replace(/[^\d]/g, '');
  let contact = await findContactByPhone(workspaceId, fromPhone);

  if (!contact) {
    const displayName = value.contacts?.[0]?.profile?.name || fromPhone;
    // Meta delivers a burst of messages together when someone sends several at
    // once (a photo plus a caption plus a follow-up). Each was creating the
    // contact independently, and all but the first lost the race on
    // Contact's (workspaceId, phoneNumber) unique constraint — the P2002 threw
    // out of the handler and those messages were dropped entirely. Converge on
    // whichever write won instead.
    //
    // Written as create-then-recover rather than upsert on purpose: Prisma
    // compiles an upsert with an empty `update` into a select-then-insert,
    // which has the same race inside it. Catching the constraint violation is
    // the only form that cannot lose.
    try {
      // Stored as E.164 like every other contact number; Meta's `from` is
      // always international digits without the "+".
      contact = await prisma.contact.create({
        data: { workspaceId, name: displayName, phoneNumber: toE164(fromPhone, { international: true }) || fromPhone },
      });
    } catch (err) {
      if (err.code !== 'P2002') throw err;
      // Whichever spelling the winning writer used ("+91…" from the UI, bare
      // digits from another webhook).
      contact = await prisma.contact.findFirst({
        where: {
          workspaceId,
          OR: [{ phoneNumber: fromPhone }, { phoneNumber: digits }, { phoneNumber: `+${digits}` }],
        },
      });
      if (!contact) throw err;
    }
  }

  // Same race, one level down: two messages from a brand-new contact can both
  // reach this point before either has created the conversation.
  const ensureConversation = async () => {
    const found = await prisma.conversation.findFirst({
      where: { workspaceId, contactId: contact.id, waNumberId: waNumber.id },
    });
    if (found) return found;
    try {
      return await prisma.conversation.create({
        data: {
          workspaceId,
          contactId: contact.id,
          waNumberId: waNumber.id,
          status: 'OPEN',
        },
      });
    } catch (err) {
      const retry = await prisma.conversation.findFirst({
        where: { workspaceId, contactId: contact.id, waNumberId: waNumber.id },
      });
      if (retry) return retry;
      throw err;
    }
  };

  let conversation = await prisma.conversation.findFirst({
    where: { workspaceId, contactId: contact.id, waNumberId: waNumber.id },
  });
  const previousLastMessageAt = conversation?.lastMessageAt ?? null;

  if (!conversation) conversation = await ensureConversation();
  // Read before this message reopens the thread: a closed conversation the
  // customer writes to again starts afresh, handoff included.
  const previousStatus = conversation.status ?? null;

  // Idempotency. Meta redelivers a webhook until it gets a 200, and retries are
  // routine — a slow response, a deploy mid-delivery, a 500. Nothing guarded
  // against it, so a redelivery wrote the message again *and* ran the whole
  // automation chain below a second time: the customer received duplicate
  // replies, and production data held inbound messages stored four times over.
  //
  // `metaMessageId` is unique now, so the create fails on a repeat. Bailing out
  // here rather than at the write is what stops the automation re-running.
  const sentAt = new Date(parseInt(msg.timestamp, 10) * 1000);
  // Attribute only when Meta provides exact evidence: the CTA payload or an
  // explicit reply context pointing at an outbound campaign message. Generic
  // inbound messages have no reliable campaign identity and stay unlinked.
  const payloadRecipientId = parseCampaignCtaPayload(buttonPayload);
  const quotedMessageId = msg.context?.id || null;
  let campaignRecipient = null;
  if (payloadRecipientId || quotedMessageId) {
    try {
      campaignRecipient = await prisma.campaignRecipient.findFirst({
        where: payloadRecipientId
          ? { id: payloadRecipientId, contactId: contact.id, campaign: { workspaceId, waNumberId: waNumber.id } }
          : { contactId: contact.id, campaign: { workspaceId, waNumberId: waNumber.id }, messages: { some: { metaMessageId: quotedMessageId } } },
        select: { id: true },
      });
    } catch (error) {
      // Attribution is optional analytics metadata: a database error here must
      // not cost the customer's message. A bug in this code is not that, so it
      // is rethrown rather than hidden behind a log line.
      if (!isPrismaError(error)) throw error;
      console.error(`[Inbound] Campaign attribution lookup failed for ${msg.id}:`, error);
    }
  }
  let stored;
  // True when this is a retry of a delivery whose automation never finished:
  // the message is already stored (and counted), only the automation is left.
  let resuming = false;
  try {
    stored = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        body: messageBody,
        direction: 'INBOUND',
        type: parsed.type,
        metaMessageId: msg.id,
        // Inbound messages have no delivery lifecycle of their own — arriving
        // is the terminal state.
        status: 'DELIVERED',
        statusAt: sentAt,
        sentAt,
        campaignRecipientId: campaignRecipient?.id ?? null,
        ...(parsed.media || {}),
        ...(parsed.location || {}),
      },
    });
  } catch (err) {
    if (err.code !== 'P2002') {
      console.error(`[Inbound] STORE FAILED — could not save message ${msg.id} to conversation ${conversation.id}: ${err.message}`);
      throw err;
    }
    // Already stored. A redelivery of a message whose automation completed is
    // dropped, as before. One whose automation did not finish — the first
    // attempt threw part-way (a pool timeout, a deploy) and BullMQ is retrying
    // — used to be dropped too, so the workflow it should have started never
    // ran (WF-IN-12). It is picked up again instead.
    const existing = await prisma.message.findUnique({
      where: { metaMessageId: msg.id },
      select: { id: true, conversationId: true, direction: true, createdAt: true, automationProcessedAt: true, transcript: true },
    });
    if (!automationUnfinished(existing)) {
      console.log(`[Inbound] Duplicate delivery of ${msg.id} — already processed, ignoring.`);
      return;
    }
    stored = existing;
    resuming = true;
    console.log(`[Inbound] Redelivery of ${msg.id}: stored, but its automation never finished — resuming it.`);
  }
  if (!resuming) console.log(`[Inbound] Message stored: ${msg.id} → conversation ${conversation.id}`);

  // A `system` event (e.g. the customer changed number) is Meta talking, not
  // the customer, and a reaction is not something anyone needs to answer.
  // Both are stored, but neither counts as unread, reopens the thread or runs
  // automation; only a system event leaves the reply window alone.
  const systemEvent = msg?.type === 'system';
  const actionable = !systemEvent && msg?.type !== 'reaction';

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      // Counted once: a resumed delivery was already counted by its first try.
      ...(actionable && !resuming ? { unreadCount: { increment: 1 } } : {}),
      lastMessageAt: new Date(),
      // Opens (or re-opens) the 24-hour window in which Meta permits a
      // free-form reply. Every outbound path checks this — see
      // services/messagingWindow.js.
      ...(systemEvent ? {} : { lastInboundAt: sentAt }),
      // A customer writing to a resolved thread reopens it, so it shows in the
      // inbox again and the delayed-response check does not skip it.
      ...(actionable && conversation.status !== 'OPEN' ? { status: 'OPEN' } : {}),
    },
  });
  if (actionable) conversation.status = 'OPEN';
  if (!resuming) realtime.messageCreated(workspaceId, conversation.id, { direction: 'INBOUND' });

  // Immediately exit active sequence cadences with exitOnReply enabled
  if (!systemEvent) await prisma.sequenceEnrollment.updateMany({
    where: {
      workspaceId,
      contactId: contact.id,
      status: { in: ['ACTIVE', 'WAITING'] },
      sequence: { exitOnReply: true },
    },
    data: {
      status: 'EXITED',
      exitReason: 'Contact replied',
      nextRunAt: null,
      completedAt: new Date(),
    },
  }).catch((err) => {
    console.error('[Inbound] Failed to auto-exit sequence enrollments:', err.message);
  });

  // Lead score and HOT/WARM/COLD depend on reply recency, so a reply refreshes
  // them (debounced per contact). Never blocks or fails the inbound path.
  import('../queues/crmMaintenance.queue.js')
    .then((m) => m.enqueueContactRescore(workspaceId, contact.id))
    .catch((err) => console.warn(`[Inbound] Contact rescore could not be queued for ${contact.id}:`, err.message));

  // Media is downloaded and archived (Meta deletes it after ~30 days), and a
  // voice note is transcribed so everything below can answer what the customer
  // said rather than ignore it (CF-224). Without a transcript the message is
  // routed as an audio message: no keyword, intent or AI step reads it, and a
  // workflow can still pick it up with the `media` trigger.
  if (resuming && stored.transcript) {
    parsed.transcript = stored.transcript;
    parsed.body = stored.transcript;
    messageBody = stored.transcript;
  } else if (parsed.media?.mediaId) {
    const media = await processInboundMedia({ workspaceId, messageId: stored.id, parsed, waNumber })
      .catch((err) => {
        console.error(`[Inbound] Media handling failed for ${msg.id}:`, err.message);
        return { transcript: null };
      });
    if (media.transcript) {
      parsed.transcript = media.transcript;
      parsed.body = media.transcript;
      messageBody = media.transcript;
    }
  }

  // Tell the customer's own system. This is the event an integration is most
  // likely to want, and until now nothing was ever dispatched. Sent once.
  if (!resuming) emitWebhook(workspaceId, 'message.received', {
    conversationId: conversation.id,
    contact: { id: contact.id, name: contact.name, phoneNumber: contact.phoneNumber },
    message: {
      id: msg.id,
      type: parsed.type,
      body: messageBody,
      from: fromPhone,
      timestamp: sentAt.toISOString(),
      ...(parsed.media || {}),
      ...(parsed.location || {}),
      ...(parsed.transcript ? { transcript: parsed.transcript } : {}),
    },
  });

  if (actionable) {
    // A retry must not answer twice. If the first attempt got as far as a
    // reply or a workflow run before it failed, that part is not repeated.
    if (resuming && await automationAlreadyActed(workspaceId, conversation.id, stored.createdAt)) {
      console.log(`[Inbound] ${msg.id}: the first attempt already replied or started a workflow — not repeating it.`);
    } else {
      // "First INBOUND message from this contact in this workspace", not "a
      // number we have never seen": contacts imported from a CSV, sent a
      // campaign or captured by a lead form exist before they ever write, and
      // were never welcomed (WF-IN-10).
      const isNewContact = await isFirstInboundMessage(workspaceId, contact.id, stored.id);
      await runInboundAutomation({
        parsed, messageBody, fromPhone, buttonPayload, waNumber, workspaceId, contact, conversation,
        previousStatus, previousLastMessageAt, isNewContact,
      });
    }
  }

  // Reached only when the pipeline finished: a throw above leaves the marker
  // unset, so the queue's retry resumes the automation.
  await prisma.message.update({
    where: { id: stored.id },
    data: { automationProcessedAt: new Date() },
  }).catch((err) => console.error(`[Inbound] Could not mark ${msg.id} as processed:`, err.message));
}

// Is this stored message one whose automation a retry should pick up?
function automationUnfinished(existing) {
  if (!existing || existing.direction !== 'INBOUND' || existing.automationProcessedAt) return false;
  const created = new Date(existing.createdAt ?? 0).getTime();
  return Date.now() - created < AUTOMATION_RESUME_WINDOW_MS;
}

// Did an earlier attempt at this message already reply or start a workflow?
// Either one means the automation reached its decision; doing it again would
// send the customer the same answer twice. A workflow run is the engine's to
// finish (its own claims and the recovery sweep cover it).
async function automationAlreadyActed(workspaceId, conversationId, since) {
  const after = new Date(since ?? 0);
  const [reply, run] = await Promise.all([
    prisma.message.findFirst({
      where: { conversationId, direction: 'OUTBOUND', createdAt: { gte: after } },
      select: { id: true },
    }),
    prisma.workflowRun.findFirst({
      where: { workspaceId, conversationId, startedAt: { gte: after } },
      select: { id: true },
    }),
  ]);
  return Boolean(reply || run);
}

async function isFirstInboundMessage(workspaceId, contactId, messageId) {
  try {
    const earlier = await prisma.message.findFirst({
      where: {
        direction: 'INBOUND',
        id: { not: messageId },
        conversation: { workspaceId, contactId },
      },
      select: { id: true },
    });
    return !earlier;
  } catch (err) {
    console.warn(`[Inbound] Could not check whether ${contactId} has written before:`, err.message);
    return false;
  }
}

// Meta sends bare international digits ("919876543210"); contacts may be stored
// with "+", spaces, dashes or in national format. Matching is on digits only,
// within the workspace, so "+91 98000 00001" (saved before numbers were
// normalised on write, CF-200) is the same person as Meta's "919800000001"
// rather than a duplicate contact treated as brand new (WF-IN-11).
async function findContactByPhone(workspaceId, fromPhone) {
  const digits = String(fromPhone || '').replace(/[^\d]/g, '');
  const exact = await prisma.contact.findFirst({
    where: {
      workspaceId,
      OR: [
        { phoneNumber: fromPhone },
        { phoneNumber: digits },
        { phoneNumber: `+${digits}` },
      ],
    },
  });
  if (exact || !digits) return exact;

  // Any spelling ending in the same ten digits, compared digits-only in SQL —
  // a LIKE on the raw column cannot see through the separators.
  const tail = digits.slice(-10);
  let candidates = [];
  try {
    const rows = await prisma.$queryRaw`
      SELECT "id" FROM "Contact"
      WHERE "workspaceId" = ${workspaceId}
        AND right(regexp_replace("phoneNumber", '[^0-9]', '', 'g'), 10) = ${tail}
      LIMIT 5`;
    const ids = (Array.isArray(rows) ? rows : []).map((r) => r.id).filter(Boolean);
    if (ids.length) candidates = await prisma.contact.findMany({ where: { workspaceId, id: { in: ids } } });
  } catch (err) {
    // The lookup only prevents a duplicate; it must not cost the message.
    console.warn(`[Inbound] Digits-only contact lookup failed in ${workspaceId}:`, err.message);
    return null;
  }

  const sameDigits = candidates.find((c) => String(c.phoneNumber).replace(/[^\d]/g, '') === digits);
  if (sameDigits) return sameDigits;
  // A contact saved in national format ("9876543210", "09876543210") never
  // equals Meta's international digits and used to be duplicated. Accept it
  // only when it is the one national-format number ending in these digits,
  // so an ambiguous match never lands on the wrong person.
  const national = candidates.filter((c) => {
    const stored = String(c.phoneNumber).replace(/[^\d]/g, '').replace(/^0+/, '');
    return !String(c.phoneNumber).trim().startsWith('+')
      && stored.length >= 7 && stored.length <= 10 && stored.length < digits.length
      && digits.endsWith(stored);
  });
  return national.length === 1 ? national[0] : null;
}

// The newest run on the conversation that is waiting for the customer's answer,
// with the options it offered. Read here rather than in the engine so the
// pipeline can tell an answer from a command before anything consumes it.
async function awaitingRunFor(workspaceId, conversationId) {
  const waiting = await prisma.workflowRun.findMany({
    where: { workspaceId, conversationId, status: 'WAITING' },
    orderBy: { startedAt: 'desc' },
    select: { id: true, variables: true, startedAt: true },
  });
  for (const run of waiting) {
    const vars = run.variables && typeof run.variables === 'object' && !Array.isArray(run.variables) ? run.variables : {};
    const awaiting = vars.__awaitingReply;
    if (!awaiting) continue;
    // A wait past its timeout is closed by the engine on this message, not
    // answered by it.
    const since = Date.parse(awaiting.since);
    if (Number.isFinite(since) && Date.now() - since > REPLY_TIMEOUT_MS) return null;
    const offered = Array.isArray(awaiting.options) && awaiting.options.length
      ? awaiting.options
      : (Array.isArray(vars.__lastOptions) ? vars.__lastOptions : []);
    return { id: run.id, options: offered.map((o) => String(o ?? '')) };
  }
  return null;
}

async function runInboundAutomation({
  parsed, messageBody, fromPhone, buttonPayload, waNumber, workspaceId, contact, conversation,
  previousStatus, previousLastMessageAt, isNewContact,
}) {
  // Only words the customer actually sent — typed, a caption, a transcribed
  // voice note or a button they tapped. `messageBody` may be a placeholder we
  // generated for a photo or a location ("[photo]"), and matching our own text
  // against keywords, opt-out words or intents would let a picture opt someone
  // out or start a workflow.
  const customerText = carriesCustomerText(parsed);
  const mediaType = mediaTypeOf(parsed);
  // What the workflow engine matches this message on, and what a suppression
  // record tests against.
  const match = { messageBody, event: inboundEvent(parsed), mediaType, isNewContact };
  const suppressed = (reason) => recordSuppressedAutomation({
    workspaceId, conversationId: conversation.id, contactId: contact.id, reason, match,
  });
  const reply = (body) => sendAutomatedReply({
    conversationId: conversation.id, waNumberId: waNumber.id, toPhone: fromPhone, body,
  });

  // What is open on the conversation. A form submission left unanswered for a
  // day, or whose form is no longer Active, is abandoned by the check rather
  // than counted (whatsappForms.service.js).
  const [formOpen, runOpen, awaitingRun] = await Promise.all([
    hasOpenSubmission(conversation.id),
    hasActiveRun(workspaceId, conversation.id),
    awaitingRunFor(workspaceId, conversation.id),
  ]);
  const flowOpen = formOpen || runOpen;
  const offeredOptions = awaitingRun?.options ?? [];
  const isOfferedOption = customerText && offeredOptions.map(normalise).includes(normalise(messageBody));

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
      // Whether an agent is actually deployed: the escalation rules are the
      // agent's, and only apply while it is.
      aiAgentEnabled: true,
      escalationRules: true,
    },
  });

  // 1. Opt back in. A contact who opted out and sends START / SUBSCRIBE is
  //    messageable again, and is told so — the confirmation goes out because
  //    the opt-out is cleared before it is sent. For anyone not opted out,
  //    "start" is an ordinary message.
  if (customerText && !isButtonReply(parsed)) {
    const optIn = matchOptInKeyword(messageBody);
    if (optIn && await isOptedOut(workspaceId, fromPhone, { contact }).catch(() => false)) {
      await recordOptIn({ workspaceId, phoneNumber: fromPhone, contactId: contact.id, keyword: optIn });
      contact.optedOut = false;
      console.log(`[Inbound] ${fromPhone} opted back in to workspace ${workspaceId} via "${optIn}"`);
      emitWebhook(workspaceId, 'optout.removed', { phoneNumber: fromPhone, keyword: optIn, contactId: contact.id });
      await notifyWorkspace(workspaceId, {
        type: 'OPT_IN',
        title: 'A contact opted back in',
        body: `${contact.name || fromPhone} sent "${optIn}" and can be messaged again.`,
        link: 'settings',
        meta: { phoneNumber: fromPhone, keyword: optIn },
      }).catch((err) => console.warn('[Inbound] Opt-in notification failed:', err.message));
      await reply(OPT_IN_CONFIRMATION);
      return;
    }
  }

  // 2. Opt-out. STOP / UNSUBSCRIBE, typed as the whole message, blocks the
  //    number and stops this message from triggering anything. A tap on one of
  //    our own buttons is never an opt-out, whatever its title says ("No
  //    thanks" is an answer). With a form or workflow open, STOP ends that flow
  //    first — the customer may mean "stop asking me this" — and a second STOP
  //    opts out.
  const optOutKeyword = customerText && !isButtonReply(parsed) && !isOfferedOption
    ? matchOptOutKeyword(messageBody)
    : null;
  if (optOutKeyword && flowOpen) {
    if (formOpen) await cancelOpenSubmission(conversation.id).catch((err) => console.error(`[Inbound] Could not cancel the open form for ${conversation.id}:`, err.message));
    if (runOpen) await cancelActiveRuns(workspaceId, conversation.id, `Customer sent "${optOutKeyword}"`).catch((err) => console.error(`[Inbound] Could not cancel workflow runs for ${conversation.id}:`, err.message));
    console.log(`[Inbound] "${optOutKeyword}" ended the open flow on ${conversation.id}; a second one opts out.`);
    await reply(CONTROL_REPLIES.stop);
    return;
  }
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
      emitWebhook(workspaceId, 'optout.created', {
        phoneNumber: fromPhone, keyword: optOutKeyword, contactId: contact.id,
      });
      await notifyWorkspace(workspaceId, {
        type: 'OPT_OUT',
        title: 'A contact opted out',
        body: `${contact.name || fromPhone} sent "${optOutKeyword}" and will no longer receive messages. They can send START to opt back in.`,
        link: 'settings',
        meta: { phoneNumber: fromPhone, keyword: optOutKeyword },
      }).catch((err) => console.warn('[Inbound] Opt-out notification failed:', err.message));
    } catch (err) {
      console.error('[Inbound] Could not record opt-out:', err.message);
    }
    await suppressed(SUPPRESSION_REASONS.optout(optOutKeyword));
    return;
  }

  // A reply to a campaign becomes a lead, if the workspace opted in. Placed
  // after the opt-out return above, so someone who has just asked to be left
  // alone is never turned into a prospect. Fire-and-forget: a CRM write must
  // never cost the platform an inbound message.
  captureReplyAsLead(workspaceId, contact.id);

  // 3. A person is holding this conversation. The message is stored, the inbox
  //    shows it and the webhook fires, but no automation runs — replying over
  //    an agent mid-conversation is worse than not replying at all. The
  //    delayed-response check is skipped too: someone is on it.
  //
  //    The hold lapses: after HANDOFF_TTL_HOURS with no reply from a person, or
  //    once the conversation has been closed, the next message runs the
  //    automation again (WF-IN-1). It used to last until someone resolved the
  //    thread by hand, so one "agent" or one escalation switched every
  //    workflow off for that contact for good.
  const handoff = await resolveHandoff(conversation, { previousStatus, workspaceId });
  if (handoff.paused) {
    console.log(`[Inbound] Conversation ${conversation.id} is with a human (${handoff.reason}) until `
      + `${handoff.resumesAt.toISOString()} — automation suppressed.`);
    await suppressed(SUPPRESSION_REASONS.handoff(handoff.reasonText));
    return;
  }

  // 4. Control commands. "cancel", "bye", "done", "restart" and "human" belong
  //    to the customer, not to whichever flow happens to be holding the
  //    conversation (QA BUG-02).
  //
  //    Matched exactly — no typo tolerance — and, while a workflow is waiting
  //    for this customer's answer, only explicit phrases ("stop this", "talk
  //    to a human") that are not one of the options offered: "None", "Done" or
  //    a button titled "Agent" are answers (WF-IN-5). Asking for a person with
  //    nothing running needs an explicit request too; a bare "agent" carries
  //    on so a workflow with that keyword can answer it (WF-IN-2).
  if (customerText) {
    const control = detectControlCommand(messageBody, { awaitingReply: Boolean(awaitingRun), options: offeredOptions });
    if (control?.command === 'human' && (control.explicit || flowOpen)) {
      // Asking for a person ends the flow whether or not one is running.
      if (formOpen) await cancelOpenSubmission(conversation.id).catch((err) => console.error(`[Inbound] Could not cancel the open form for ${conversation.id}:`, err.message));
      if (runOpen) await cancelActiveRuns(workspaceId, conversation.id, 'Customer asked for a person').catch((err) => console.error(`[Inbound] Could not cancel workflow runs for ${conversation.id}:`, err.message));
      await escalateToHuman({
        workspaceId, conversationId: conversation.id, contact,
        reason: 'The customer asked to speak to a person',
        reasonCode: HANDOFF_REASONS.CUSTOMER_ASKED_HUMAN,
      });
      await suppressed(SUPPRESSION_REASONS.control(control.matched));
      await scheduleDelayedResponse(workspace, conversation.id);
      return;
    }

    if (control && control.command !== 'human' && interruptsFlow(control.command) && flowOpen) {
      // Any workflow parked on a delay is torn down either way, so it cannot
      // wake up hours later and carry on messaging someone who has left.
      if (runOpen) {
        await cancelActiveRuns(workspaceId, conversation.id, `Customer sent "${control.matched}"`).catch((err) => console.error(`[Inbound] Could not cancel workflow runs for ${conversation.id}:`, err.message));
      }

      // When a form is open it owns the acknowledgement: it is the only layer
      // that knows how to re-ask question one for "restart", and it replies
      // for the other commands too. Cancelling the submission here as well
      // would leave the customer with no answer at all.
      if (formOpen) {
        console.log(`[Inbound] "${control.matched}" interrupting the open form.`);
      } else {
        await reply(CONTROL_REPLIES[control.command] || CONTROL_REPLIES.cancel);
        await suppressed(SUPPRESSION_REASONS.control(control.matched));
        await scheduleDelayedResponse(workspace, conversation.id);
        return;
      }
    }
  }

  // 5. Campaign AI Agent. A customer who tapped a campaign's "Ask Anything"
  //    CTA is in a conversation *about that campaign*, and every message until
  //    the session expires belongs to the agent that was attached to it.
  //    Returns false unless a CTA was tapped or a session is live, so nothing
  //    changes for workspaces that don't use the feature.
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

  // 6. A form in progress owns the conversation until it finishes — the
  //    customer is answering a question, not starting a new automation. A
  //    photo or an untranscribed voice note is not an answer (its body is our
  //    placeholder), so the form keeps waiting for one. A submission idle for a
  //    few minutes lets go when the message is something an active workflow
  //    or trigger answers.
  if (customerText) {
    const consumedByForm = await handleFormInbound({
      workspaceId,
      conversation,
      contact,
      messageBody,
      matchesAutomation: (body) => automationWouldAnswer(workspaceId, { ...match, messageBody: body }),
    }).catch((err) => {
      console.error('[Inbound] Form handling failed:', err);
      return false;
    });
    if (consumedByForm) {
      await suppressed(SUPPRESSION_REASONS.form(formOpen ? 'it answered the question on screen' : 'its keyword started a form'));
      await scheduleDelayedResponse(workspace, conversation.id);
      return;
    }
  }

  // 7. Workflows. A run waiting on this customer's answer takes the message
  //    first — they are replying to its question, not starting something new.
  //    Only customer text answers it: a photo or a voice note with no
  //    transcript used to be saved as the literal "[photo]" (WF-IN-9); the run
  //    now keeps waiting, and the media can still start a `media` workflow.
  let workflowWillReply = false;
  try {
    console.log(`[Automation] Checking active workflows for conversation ${conversation.id} (workspace ${workspaceId})`);
    let resumed = null;
    if (customerText) {
      resumed = await resumeAwaitingRun(workspaceId, conversation.id, messageBody);
      if (resumed) console.log(`[Automation] Reply resumed waiting run ${resumed.id} → ${resumed.status}`);
    } else if (awaitingRun) {
      console.log(`[Automation] Run ${awaitingRun.id} is waiting for a reply; a ${parsed.type.toLowerCase()} message with no text does not answer it — still waiting.`);
    }
    const runs = resumed ? [resumed] : await runWorkflowsForInbound(workspaceId, {
      ...match,
      conversationId: conversation.id,
      contactId: contact.id,
    });
    workflowWillReply = runs.some(runWillSendMessage);
  } catch (err) {
    console.error('[Inbound] Workflow execution failed:', err);
  }

  let autoReplyText = null;
  let intentHint = null;

  // 8. Exact keyword trigger (deterministic, highest priority after workflows).
  if (customerText && !workflowWillReply) {
    const trigger = await findMatchingTrigger(workspaceId, messageBody);
    if (trigger) autoReplyText = trigger.responseTemplate;

    // 9. Intent rules. A rule can hand the thread to a person, answer from a
    //    trigger, start a workflow, or tell the agent what the customer is
    //    asking about. Available on every plan: only the model needs
    //    campaignAi (WF-IN-14).
    if (!autoReplyText) {
      const routed = await routeByIntent({
        workspaceId, conversationId: conversation.id, contact, waNumber, messageBody,
      }).catch((err) => {
        console.error('[Inbound] Intent routing failed:', err);
        return null;
      });
      if (routed?.handled) {
        await scheduleDelayedResponse(workspace, conversation.id);
        return;
      }
      if (routed?.replyText) autoReplyText = routed.replyText;
      if (routed?.intentHint) intentHint = routed.intentHint;
    }

    // 10. Legacy fuzzy keyword matching against automation triggers, kept as
    //     the last deterministic attempt before the model.
    //
    //     Skipped when an intent rule has already classified the message and
    //     asked for an AI answer: the operator wrote that rule to say what this
    //     message is about, and letting a fuzzy keyword match answer instead
    //     throws that away — which is how "where is my order" ended up being
    //     answered by the HELP trigger's greeting.
    if (!autoReplyText && !intentHint) {
      const intent = await matchIntent(workspaceId, messageBody).catch((err) => { console.warn('[Inbound] Intent matching failed:', err.message); return null; });
      if (intent?.trigger) autoReplyText = intent.trigger.responseTemplate;
    }
  }

  // 11. Escalation rules. "Refund", "this is useless", "customer service" —
  //     the AI agent's own rules for stepping back and bringing in a person.
  //     They apply only while an agent is deployed, and only once workflows,
  //     keyword triggers and intent rules have had their chance (WF-IN-3).
  //     They used to run on every workspace that had ever saved the AI Agent
  //     screen, ahead of the keyword triggers, and silently paused automation
  //     on the contact.
  if (customerText && !workflowWillReply && !autoReplyText && escalationRulesApply(workspace)) {
    const hit = escalationMatch(messageBody, workspace.escalationRules);
    if (hit) {
      console.log(`[Inbound] Escalation rule "${hit.rule}" claimed "${messageBody.slice(0, 80)}" — `
        + 'conversation handed to a person; automation paused on it until someone replies or it lapses.');
      await escalateToHuman({
        workspaceId, conversationId: conversation.id, contact, reason: hit.reason, reasonCode: hit.reasonCode,
      });
      await scheduleDelayedResponse(workspace, conversation.id);
      return;
    }
  }

  // 12. Welcome / out-of-office. Both messages are workspace-configurable now,
  //     and OOO additionally fires outside working hours — which is what the UI
  //     has always claimed it did.
  if (!autoReplyText && !workflowWillReply) {
    const isReturningAfterGap = !isNewContact && previousLastMessageAt
      && (Date.now() - new Date(previousLastMessageAt).getTime()) > WELCOME_MESSAGE_GAP_MS;
    const closedNow = !isWithinBusinessHours(workspace?.businessHours);

    // Greet a contact on their first message, or one coming back after a day
    // away, and only if we have not already greeted them inside that same
    // window (QA BUG-07).
    const shouldWelcome = workspace?.autoWelcomeEnabled
      && workspace.welcomeMessage
      && (isNewContact || isReturningAfterGap);

    if (shouldWelcome && !(await alreadyWelcomed(conversation.id, workspace.welcomeMessage))) {
      autoReplyText = workspace.welcomeMessage;
    } else if (workspace?.autoOooEnabled && closedNow) {
      autoReplyText = workspace.oooMessage;
    }
  }

  // 13. Everyday conversational messages. "hi", "bye", "thanks" and "working
  //     hours" are the messages every business receives and the ones the
  //     workspace is least likely to have written a rule for (QA BUG-03).
  //     Deliberately below the workspace's own automations.
  if (!autoReplyText && !workflowWillReply && customerText) {
    const general = detectGeneralIntent(messageBody);
    if (general) {
      autoReplyText = generalIntentReply(general.intent, { workspace, contact });
      if (autoReplyText) {
        console.log(`[Inbound] "${messageBody}" answered as a ${general.intent} message.`);
      }
    }
  }

  // 14. AI Agent fallback — a deployed LLM agent answers free-form questions
  //     when nothing above matched.
  if (!autoReplyText && !workflowWillReply && customerText) {
    autoReplyText = await generateAgentReply(workspaceId, messageBody, {
      contactName: contact?.name,
      conversationId: conversation.id,
      waNumberId: waNumber.id,
      intentHint,
    }).catch((err) => { console.error(`[Inbound] AI agent reply failed for ${conversation.id}:`, err.message); return null; });

    // Nothing to say. The message is left unanswered: it is in the inbox,
    // unread, and the delayed-response automation exists to chase exactly
    // this. It is NOT handed to a person — a missing API key or a Gemini 503
    // used to escalate, which paused every workflow on the contact (WF-IN-4).
    if (!autoReplyText) {
      const cause = await agentSilenceCause(workspaceId, workspace);
      console.log(`[Inbound] Nothing answered "${String(messageBody).slice(0, 80)}" — ${cause}. `
        + 'Left for the inbox; automation stays on for this contact.');
      await scheduleDelayedResponse(workspace, conversation.id);
      return;
    }
  }

  if (autoReplyText) await reply(autoReplyText);

  await scheduleDelayedResponse(workspace, conversation.id);
}

// Would an active workflow or keyword trigger answer this message? Lets a
// stale form submission step aside for one.
async function automationWouldAnswer(workspaceId, match) {
  const [workflows, trigger] = await Promise.all([
    findMatchingWorkflows(workspaceId, match).catch(() => []),
    findMatchingTrigger(workspaceId, match.messageBody).catch(() => null),
  ]);
  return workflows.length > 0 || Boolean(trigger);
}

// Why the AI agent produced no reply, stated precisely. The old log said "no
// AI agent is deployed" whenever the agent was silent, which sent people
// looking in the wrong place when the real cause was the plan or the provider.
async function agentSilenceCause(workspaceId, workspace) {
  if (!workspace?.aiAgentEnabled) return 'no AI agent is deployed';
  if (!llmAvailable()) return 'the AI agent is deployed but no LLM provider is configured (GEMINI_API_KEY)';
  if (!await planAllows(workspaceId, 'campaignAi')) {
    return "the AI agent is deployed but the workspace's plan does not include the campaignAi feature";
  }
  return 'the AI agent returned no reply (provider error, timeout or rate limit)';
}

// Have we already sent this workspace's welcome message on this conversation
// within the last day? Derived from the message history rather than a new
// column so the fix needs no schema migration to deploy.
async function alreadyWelcomed(conversationId, welcomeMessage) {
  try {
    const since = new Date(Date.now() - WELCOME_MESSAGE_GAP_MS);
    const count = await prisma.message.count({
      where: {
        conversationId,
        direction: 'OUTBOUND',
        body: welcomeMessage,
        sentAt: { gte: since },
      },
    });
    return count > 0;
  } catch (err) {
    // A failed lookup must not cost the customer their greeting.
    console.error('[Inbound] Could not check welcome history:', err.message);
    return false;
  }
}

// Canned answers for the everyday intents. Business hours are read back from
// the workspace's own Working Hours configuration rather than invented, and any
// intent with nothing useful to say returns null so the AI agent still gets its
// turn.
function generalIntentReply(intent, { workspace, contact }) {
  const name = contact?.name ? ` ${String(contact.name).split(' ')[0]}` : '';
  switch (intent) {
    case 'greeting':
      // Deliberately not the workspace's welcome message: that one belongs to a
      // first contact, and reusing it here meant a returning customer saying
      // "hello" was welcomed to the business all over again (QA BUG-07).
      return `Hello${name}! How can we help you today?`;
    case 'goodbye':
      return CONTROL_REPLIES.goodbye;
    case 'thanks':
      return "You're very welcome! Let us know if there's anything else.";
    case 'business_hours': {
      const summary = describeBusinessHours(workspace?.businessHours);
      if (summary) return summary;
      // Working hours are switched off or unset. Returning null here sent the
      // question to the AI agent, which had nothing to say either, which
      // escalated the thread to a person — so one "working hours" message
      // silenced every automation on the conversation from then on. Saying we
      // are always reachable is both true and recoverable.
      return "We don't publish set working hours — send us a message any time and we'll get back to you as soon as we can.";
    }
    // 'help' and 'human' are intentionally not answered here: help depends on
    // what this workspace actually offers, and asking for a person is handled
    // by the escalation step above.
    default:
      return null;
  }
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
  const metaMessageId = typeof status?.id === 'string' ? status.id : null;
  if (!metaMessageId) return;

  const newStatus = String(status?.status || '').toLowerCase();
  const timestamp = Number(status?.timestamp);
  const eventTime = Number.isFinite(timestamp) && timestamp > 0
    ? new Date(timestamp * 1000)
    : new Date();

  // Authentication sends do not create a normal Message row, but they do keep
  // Meta's id on AuthenticationTransaction. A `read` receipt also proves the
  // message was delivered. The null guard makes replayed/out-of-order webhooks
  // idempotent without treating Meta acceptance as delivery.
  if (newStatus === 'delivered' || newStatus === 'read') {
    const transactions = await prisma.authenticationTransaction.findMany({
      where: { metaMessageId },
      select: { id: true, deliveredAt: true },
      take: 2,
    });

    // The database uniqueness constraint prevents this after migration. Keep
    // the guard for legacy/corrupt data: never let one Meta receipt mark more
    // than one OTP transaction as delivered.
    if (transactions.length > 1) {
      console.error(`[Authentication] Duplicate Meta message id "${metaMessageId}"; delivery receipt ignored.`);
    } else if (transactions.length === 1 && transactions[0].deliveredAt == null) {
      await prisma.authenticationTransaction.updateMany({
        where: { id: transactions[0].id, deliveredAt: null },
        data: { deliveredAt: eventTime },
      });
    }
  }

  const message = await prisma.message.findUnique({
    where: { metaMessageId },
    // The conversation carries the workspace — Message itself does not, and the
    // outgoing webhook has to be addressed to a workspace.
    select: { id: true, conversationId: true, campaignRecipientId: true, status: true, conversation: { select: { workspaceId: true } } },
  });
  if (!message) return;

  // Record the status on the message itself, whatever sent it.
  //
  // This used to return immediately unless the message belonged to a campaign,
  // so a human's inbox reply and every automated reply had no delivery state at
  // all — the inbox could not show a tick, and "was that delivered?" had no
  // answer. Campaign counters are still maintained below; they are now one
  // consumer of this event rather than the only one.
  const mapped = { sent: 'SENT', delivered: 'DELIVERED', read: 'READ', failed: 'FAILED' }[newStatus];
  if (!mapped) return;

  // Statuses arrive out of order and are redelivered, so a message only ever
  // moves forward: PENDING → SENT → DELIVERED → READ, with FAILED reachable
  // from anything short of READ. READ and FAILED are terminal — a stale
  // `failed` cannot undo a read, and a late `delivered` cannot revive a
  // failed send. The guard is part of the write, so two concurrent events
  // cannot both apply.
  const errObj = status.errors?.[0];
  const { count: transitioned } = await prisma.message.updateMany({
    where: { id: message.id, status: { in: MESSAGE_STATUS_FROM[mapped] } },
    data: {
      status: mapped,
      statusAt: eventTime,
      ...(mapped === 'FAILED'
        ? {
            errorCode: errObj?.code ?? null,
            errorMessage: errObj?.title || errObj?.message || 'Delivery failed',
          }
        : {}),
    },
  });

  if (transitioned > 0) realtime.messageStatus(message.conversation.workspaceId, message.conversationId, { messageId: message.id, status: mapped });
  emitWebhook(message.conversation.workspaceId, 'message.status', {
    messageId: metaMessageId,
    status: mapped,
    at: eventTime.toISOString(),
    recipientId: status.recipient_id ?? null,
    error: errObj ?? null,
  });

  // Everything below is campaign bookkeeping, which only applies to a send that
  // belongs to a campaign recipient — and only to an event that actually moved
  // this message on. A redelivered or out-of-date receipt has nothing to add.
  if (!message.campaignRecipientId || transitioned === 0) return;

  const recipient = await prisma.campaignRecipient.findUnique({
    where: { id: message.campaignRecipientId },
    select: { id: true, campaignId: true, contactId: true, retryCount: true, status: true, deliveredAt: true, readAt: true, failedAt: true },
  });
  if (!recipient) return;

  // Receipts only advance a recipient whose current attempt is out. One that
  // an earlier `failed` already moved to RETRYING/FAILED stays there, so a
  // late receipt cannot flip it back and skew the campaign counters.
  if (newStatus === 'delivered') {
    const updated = await prisma.campaignRecipient.updateMany({
      where: { id: recipient.id, deliveredAt: null, status: 'SENT' },
      data: { deliveredAt: eventTime, status: 'DELIVERED' },
    });
    if (updated.count > 0) {
      await prisma.campaign.update({
        where: { id: recipient.campaignId },
        data: { delivered: { increment: 1 } },
      });
    }
  } else if (newStatus === 'read') {
    const readUpdated = await prisma.campaignRecipient.updateMany({
      where: { id: recipient.id, readAt: null, status: { in: ['SENT', 'DELIVERED'] } },
      data: { readAt: eventTime, status: 'READ' },
    });
    
    if (readUpdated.count > 0) {
      const deliveryUpdated = await prisma.campaignRecipient.updateMany({
        where: { id: recipient.id, deliveredAt: null },
        data: { deliveredAt: eventTime },
      });
      
      await prisma.campaign.update({
        where: { id: recipient.campaignId },
        data: {
          read: { increment: 1 },
          ...(deliveryUpdated.count > 0 ? { delivered: { increment: 1 } } : {}),
        },
      });
    }
  } else if (newStatus === 'failed' && !recipient.failedAt && ['SENDING', 'SENT', 'DELIVERED'].includes(recipient.status)) {
    const code = errObj?.code;
    const reason = errObj ? `${errObj.title || errObj.message || 'Delivery failed'}${code ? ` (code ${code})` : ''}` : 'Delivery failed';

    const campaign = await prisma.campaign.findUnique({
      where: { id: recipient.campaignId },
    });
    if (campaign) {
      const contact = await prisma.contact.findUnique({ where: { id: recipient.contactId } }).catch((err) => { console.warn(`[Inbound] Could not load contact ${recipient.contactId} for failure handling:`, err.message); return null; });
      await handleRecipientFailure(campaign, { ...recipient, contact }, reason, code);
    }
  }
  realtime.campaignUpdated(message.conversation.workspaceId, recipient.campaignId);
}
