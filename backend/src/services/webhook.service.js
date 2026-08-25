import { prisma } from '../lib/prisma.js';
import { findMatchingTrigger } from './automation.service.js';
import { matchIntent, generateAgentReply } from './aiAgent.service.js';
import { handleCampaignAiInbound } from './campaignAi.service.js';
import { queueTemplateApprovedEmail, queueTemplateRejectedEmail } from './email.service.js';
import { handleRecipientFailure } from './retry.service.js';
import { sendAutomatedReply } from './outbound.service.js';
import { runWorkflowsForInbound, runWillSendMessage, cancelActiveRuns, hasActiveRun } from './workflowEngine.service.js';
import { handleFormInbound, cancelOpenSubmission, hasOpenSubmission } from './whatsappForms.service.js';
import { MESSAGE_CATEGORY_RATES } from '../lib/messagePricing.js';
import { isWithinBusinessHours, describeBusinessHours } from './businessHours.service.js';
import { matchOptOutKeyword, recordOptOut, isFlowControlKeyword } from './optout.service.js';
import { notifyWorkspace } from './notification.service.js';
import { parseInboundMessage, carriesCustomerText } from './inboundMessage.js';
import { emitWebhook } from './outgoingWebhook.service.js';
import { routeByIntent, escalateToHuman, escalationReason } from './intentRouting.service.js';
import { detectControlCommand, interruptsFlow, detectGeneralIntent, CONTROL_REPLIES } from './conversationControl.service.js';

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
      emitWebhook(t.workspaceId, 'template.status', { name: t.name, status: newStatus, event });
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

// Routing order for an inbound customer message.
//
// Several subsystems can each claim to own the same message — a keyword
// trigger, a workflow, an intent rule and the AI agent will all happily answer
// "hi" — and when the order between them was implicit, a generic message got
// answered by whichever one happened to run first (QA BUG-05). The order below
// is the contract; anything added later has to be given a place in it.
//
//   1. Opt-out              — "stop"/"unsubscribe" always win. "cancel", "quit"
//                             and "end" defer to the flow when one is open.
//   2. Human handoff        — a person has the thread; automation stays out.
//   3. Global commands      — cancel / bye / done / exit / restart / human,
//                             which outrank whatever flow is mid-question.
//   4. Campaign AI session  — a live conversation about a specific campaign.
//   5. Form in flight       — the customer is answering a question we asked.
//   6. Workflows            — a workflow trigger matched.
//   7. Escalation rules     — the workspace's own "hand this to a person" rules.
//   8. Exact keyword trigger
//   9. Intent rules         — the Intent Matching screen's rules.
//  10. Fuzzy keyword trigger
//  11. Welcome / out-of-office
//  12. General conversation — greeting, goodbye, thanks, working hours.
//  13. AI agent
//  14. Fallback             — hand to a person rather than say nothing.
//
// Earlier layers are more deterministic and more specific; the model only sees
// what nothing above it claimed.
async function handleInboundMessage(value, msg) {
  const phoneNumberId = value.metadata?.phone_number_id;
  const fromPhone = msg.from;

  // Every inbound shape Meta sends, not just the four that used to be handled
  // (see services/inboundMessage.js). Media, location and contact cards were
  // previously stored as an empty body with no trace of the attachment.
  const parsed = parseInboundMessage(msg);
  const messageBody = parsed.body;

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
      contact = await prisma.contact.create({
        data: { workspaceId: waNumber.workspaceId, name: displayName, phoneNumber: fromPhone },
      });
    } catch (err) {
      if (err.code !== 'P2002') throw err;
      contact = await prisma.contact.findUnique({
        where: { workspaceId_phoneNumber: { workspaceId: waNumber.workspaceId, phoneNumber: fromPhone } },
      });
      if (!contact) throw err;
    }
  }

  // Same race, one level down: two messages from a brand-new contact can both
  // reach this point before either has created the conversation.
  const ensureConversation = async () => {
    const found = await prisma.conversation.findFirst({
      where: { workspaceId: waNumber.workspaceId, contactId: contact.id, waNumberId: waNumber.id },
    });
    if (found) return found;
    try {
      return await prisma.conversation.create({
        data: {
          workspaceId: waNumber.workspaceId,
          contactId: contact.id,
          waNumberId: waNumber.id,
          status: 'OPEN',
        },
      });
    } catch (err) {
      const retry = await prisma.conversation.findFirst({
        where: { workspaceId: waNumber.workspaceId, contactId: contact.id, waNumberId: waNumber.id },
      });
      if (retry) return retry;
      throw err;
    }
  };

  let conversation = await prisma.conversation.findFirst({
    where: { workspaceId: waNumber.workspaceId, contactId: contact.id, waNumberId: waNumber.id },
  });
  const wasClosed = conversation?.status === 'CLOSED';
  const previousLastMessageAt = conversation?.lastMessageAt ?? null;

  if (!conversation) conversation = await ensureConversation();

  // Idempotency. Meta redelivers a webhook until it gets a 200, and retries are
  // routine — a slow response, a deploy mid-delivery, a 500. Nothing guarded
  // against it, so a redelivery wrote the message again *and* ran the whole
  // automation chain below a second time: the customer received duplicate
  // replies, and production data held inbound messages stored four times over.
  //
  // `metaMessageId` is unique now, so the create fails on a repeat. Bailing out
  // here rather than at the write is what stops the automation re-running.
  const sentAt = new Date(parseInt(msg.timestamp, 10) * 1000);
  try {
    await prisma.message.create({
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
        ...(parsed.media || {}),
        ...(parsed.location || {}),
      },
    });
  } catch (err) {
    if (err.code === 'P2002') {
      console.log(`[Inbound] Duplicate delivery of ${msg.id} — already processed, ignoring.`);
      return;
    }
    throw err;
  }

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      unreadCount: { increment: 1 },
      lastMessageAt: new Date(),
      // Opens (or re-opens) the 24-hour window in which Meta permits a
      // free-form reply. Every outbound path checks this — see
      // services/messagingWindow.js.
      lastInboundAt: sentAt,
    },
  });

  const workspaceId = waNumber.workspaceId;

  // Tell the customer's own system. This is the event an integration is most
  // likely to want, and until now nothing was ever dispatched.
  emitWebhook(workspaceId, 'message.received', {
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
    },
  });

  // 0. Opt-out beats everything. A STOP (or any accepted opt-out keyword)
  //    blocks the number for good and stops this message from triggering any
  //    automation — replying to someone who just asked to be left alone is
  //    exactly what opting out is supposed to prevent. Matching ignores case,
  //    surrounding spaces and punctuation, so "STOP", " stop ", "Stop." and
  //    "STOP!" all land here. Repeat STOPs are idempotent.
  // Only words the customer actually typed. `messageBody` may be a placeholder
  // we generated for a photo or a location, and matching our own text against
  // the opt-out keywords would let a picture opt someone out.
  const customerText = carriesCustomerText(parsed);
  let optOutKeyword = customerText ? matchOptOutKeyword(messageBody) : null;

  // "cancel", "quit" and "end" are opt-out keywords *and* the words a customer
  // uses to back out of a form. Answering a form question with "cancel"
  // unsubscribed the contact from the workspace entirely (QA BUG-02/BUG-05),
  // which is not what anyone meant by it. While a flow is mid-question those
  // three mean "leave the flow" and are handled further down; "stop" and
  // "unsubscribe" always opt out, flow or no flow.
  if (optOutKeyword && isFlowControlKeyword(optOutKeyword)) {
    const [formOpen, runOpen] = await Promise.all([
      hasOpenSubmission(conversation.id),
      hasActiveRun(workspaceId, conversation.id),
    ]);
    if (formOpen || runOpen) {
      console.log(`[Inbound] "${optOutKeyword}" read as leaving the active flow, not as an opt-out.`);
      optOutKeyword = null;
    }
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
      // Whether an agent is actually deployed — the fallback below has to tell
      // "the agent tried and failed" apart from "there is no agent at all".
      aiAgentEnabled: true,
      // Read at last: the AI Agent screen has offered these for a long time
      // and nothing consulted them, so the agent answered every message itself
      // and there was no route from automation to a person.
      escalationRules: true,
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
  // A person is holding this conversation. The message is stored, the inbox
  // shows it and the webhook fires, but no automation runs — replying over an
  // agent mid-conversation is worse than not replying at all, and it is exactly
  // what handing off is meant to stop.
  //
  // The delayed-response check is skipped too: its whole purpose is to chase a
  // thread nobody has answered, and someone has.
  if (conversation.humanHandoffAt) {
    console.log(`[Inbound] Conversation ${conversation.id} is with a human since `
      + `${conversation.humanHandoffAt.toISOString()} — automation suppressed.`);
    return;
  }

  // 0. Global control commands. "cancel", "bye", "done", "exit", "restart" and
  //    "human" belong to the customer, not to whichever flow happens to be
  //    holding the conversation — before this, a form or workflow filed them as
  //    answers and kept asking its question (QA BUG-02).
  //
  //    "stop" is not in this list on purpose: it is handled above as an
  //    opt-out, which WhatsApp expects a business to honour and which stops the
  //    flow anyway by suppressing every outbound message.
  //
  //    Only intercepts when something is actually running. With no flow in
  //    flight, "bye" is an ordinary message and carries on down the chain so a
  //    workspace's own goodbye automation still gets its turn.
  if (customerText) {
    const control = detectControlCommand(messageBody);
    if (control && interruptsFlow(control.command)) {
      const [formOpen, runOpen] = await Promise.all([
        hasOpenSubmission(conversation.id),
        hasActiveRun(workspaceId, conversation.id),
      ]);

      if (control.command === 'human') {
        // Asking for a person ends the flow whether or not one is running.
        if (formOpen) await cancelOpenSubmission(conversation.id).catch(() => {});
        if (runOpen) await cancelActiveRuns(workspaceId, conversation.id, 'Customer asked for a person').catch(() => {});
        await escalateToHuman({
          workspaceId, conversationId: conversation.id, contact,
          reason: 'The customer asked to speak to a person',
        });
        await scheduleDelayedResponse(workspace, conversation.id);
        return;
      }

      if (formOpen || runOpen) {
        // Any workflow parked on a delay is torn down either way, so it cannot
        // wake up hours later and carry on messaging someone who has left.
        if (runOpen) {
          await cancelActiveRuns(workspaceId, conversation.id, `Customer sent "${control.matched}"`).catch(() => {});
        }

        // When a form is open it owns the acknowledgement: it is the only layer
        // that knows how to re-ask question one for "restart", and it replies
        // for the other commands too. Cancelling the submission here as well
        // would leave the customer with no answer at all.
        if (formOpen) {
          console.log(`[Inbound] "${control.matched}" interrupting the open form.`);
        } else {
          await sendAutomatedReply({
            conversationId: conversation.id,
            waNumberId: waNumber.id,
            toPhone: fromPhone,
            body: CONTROL_REPLIES[control.command] || CONTROL_REPLIES.cancel,
          });
          await scheduleDelayedResponse(workspace, conversation.id);
          return;
        }
      }
    }
  }

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
  let intentHint = null;

  // 1.5 Escalation. A customer asking for a person, or raising a refund, must
  //     reach one — checked before any automation answers, because the worst
  //     outcome here is a bot talking over someone who has already asked it to
  //     stop. Which conditions apply is the workspace's own choice
  //     (escalationRules on the AI Agent screen), and until now nothing read
  //     them.
  if (customerText && !workflowWillReply) {
    const reason = escalationReason(messageBody, workspace?.escalationRules);
    if (reason) {
      await escalateToHuman({ workspaceId, conversationId: conversation.id, contact, reason });
      await scheduleDelayedResponse(workspace, conversation.id);
      return;
    }
  }

  // 2. Exact keyword trigger (deterministic, highest priority after workflows).
  if (customerText && !workflowWillReply) {
    const trigger = await findMatchingTrigger(workspaceId, messageBody);
    if (trigger) autoReplyText = trigger.responseTemplate;

    // 3. Intent rules. The Intent Matching screen creates, tests and charts
    //    these, and nothing in the inbound path ever consulted them — the only
    //    importer of intent.service.js was its own controller, so every rule
    //    routed nothing at all. A rule can hand the thread to a person, answer
    //    from a trigger, start a workflow, or tell the agent what the customer
    //    is asking about.
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

    // 3b. Legacy fuzzy keyword matching against automation triggers, kept as
    //     the last deterministic attempt before the model.
    //
    //     Skipped when an intent rule has already classified the message and
    //     asked for an AI answer: the operator wrote that rule to say what this
    //     message is about, and letting a fuzzy keyword match answer instead
    //     throws that away — which is how "where is my order" ended up being
    //     answered by the HELP trigger's greeting.
    if (!autoReplyText && !intentHint) {
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

    // `isNewContact` is only true for the very first message ever received from
    // a number, and a burst of messages or a workflow that answered the first
    // one meant the greeting was sometimes sent twice and sometimes never
    // (QA BUG-07). The rule is now stated once: greet a first-time contact, or
    // one coming back after a day away, and only if we have not already greeted
    // them inside that same window.
    const shouldWelcome = workspace?.autoWelcomeEnabled
      && workspace.welcomeMessage
      && (isNewContact || isReturningAfterGap);

    if (shouldWelcome && !(await alreadyWelcomed(conversation.id, workspace.welcomeMessage))) {
      autoReplyText = workspace.welcomeMessage;
    } else if (workspace?.autoOooEnabled && (wasClosed || closedNow)) {
      autoReplyText = workspace.oooMessage;
    }
  }

  // 4.5 Everyday conversational messages. "hi", "bye", "thanks" and "working
  //     hours" are the messages every business receives and the ones the
  //     workspace is least likely to have written a rule for. They used to fall
  //     all the way through to the model, so the same greeting was answered
  //     differently from one day to the next, or not at all (QA BUG-03).
  //
  //     Deliberately below the workspace's own automations: a business that has
  //     built a greeting trigger or a "Greeting" intent keeps using it, and this
  //     only catches what nothing else claimed.
  if (!autoReplyText && !workflowWillReply && customerText) {
    const general = detectGeneralIntent(messageBody);
    if (general) {
      autoReplyText = generalIntentReply(general.intent, { workspace, contact });
      if (autoReplyText) {
        console.log(`[Inbound] "${messageBody}" answered as a ${general.intent} message.`);
      }
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
  if (!autoReplyText && !workflowWillReply && customerText) {
    autoReplyText = await generateAgentReply(workspaceId, messageBody, {
      contactName: contact?.name,
      conversationId: conversation.id,
      waNumberId: waNumber.id,
      intentHint,
    }).catch(() => null);

    // The agent had nothing to say. Handing the thread to a person is right
    // when an agent was *supposed* to answer and could not — the provider
    // failed, or it declined.
    //
    // It is wrong when the workspace has no agent deployed at all. Escalating
    // there sets humanHandoffAt, which suppresses automation on the
    // conversation from then on — so on a workspace with no AI agent (the
    // default), the first message that matched nothing silently switched off
    // every keyword trigger, workflow and form for that contact, permanently.
    // That is the "sometimes received no appropriate workflow response"
    // behaviour in the QA report (BUG-03).
    //
    // With no agent deployed the message is simply left unanswered: it is in
    // the inbox, unread, and the delayed-response automation exists precisely
    // to chase a thread nobody has replied to.
    if (!autoReplyText) {
      if (workspace?.aiAgentEnabled) {
        await escalateToHuman({
          workspaceId,
          conversationId: conversation.id,
          contact,
          reason: 'The AI agent could not answer this message',
        });
      } else {
        console.log(`[Inbound] Nothing matched "${messageBody}" and no AI agent is deployed — `
          + 'left for the inbox rather than seizing the conversation.');
      }
      await scheduleDelayedResponse(workspace, conversation.id);
      return;
    }
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
  const metaMessageId = status.id;
  const newStatus = status.status;
  const eventTime = status.timestamp ? new Date(parseInt(status.timestamp, 10) * 1000) : new Date();

  const message = await prisma.message.findUnique({
    where: { metaMessageId },
    // The conversation carries the workspace — Message itself does not, and the
    // outgoing webhook has to be addressed to a workspace.
    select: { id: true, campaignRecipientId: true, status: true, conversation: { select: { workspaceId: true } } },
  });
  if (!message) return;

  // Record the status on the message itself, whatever sent it.
  //
  // This used to return immediately unless the message belonged to a campaign,
  // so a human's inbox reply and every automated reply had no delivery state at
  // all — the inbox could not show a tick, and "was that delivered?" had no
  // answer. Campaign counters are still maintained below; they are now one
  // consumer of this event rather than the only one.
  const RANK = { PENDING: 0, SENT: 1, DELIVERED: 2, READ: 3 };
  const mapped = { sent: 'SENT', delivered: 'DELIVERED', read: 'READ', failed: 'FAILED' }[newStatus];
  if (mapped) {
    const errObj = status.errors?.[0];
    // Statuses can arrive out of order (a `read` before its `delivered`).
    // Never move a message backwards — but `failed` always wins, since it is
    // terminal and is the one the user most needs to see.
    const isRegression = mapped !== 'FAILED'
      && message.status !== 'FAILED'
      && (RANK[mapped] ?? 0) <= (RANK[message.status] ?? 0);
    if (!isRegression) {
      await prisma.message.update({
        where: { id: message.id },
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
      }).catch((err) => console.error('[Status] Could not update message:', err.message));
    }
  }

  if (mapped) {
    emitWebhook(message.conversation.workspaceId, 'message.status', {
      messageId: metaMessageId,
      status: mapped,
      at: eventTime.toISOString(),
      recipientId: status.recipient_id ?? null,
      error: status.errors?.[0] ?? null,
    });
  }

  // Everything below is campaign bookkeeping, which only applies to a send that
  // belongs to a campaign recipient.
  if (!message.campaignRecipientId) return;

  const recipient = await prisma.campaignRecipient.findUnique({
    where: { id: message.campaignRecipientId },
    select: { id: true, campaignId: true, contactId: true, retryCount: true, status: true, deliveredAt: true, readAt: true, failedAt: true },
  });
  if (!recipient) return;

  if (newStatus === 'delivered') {
    const updated = await prisma.campaignRecipient.updateMany({
      where: { id: recipient.id, deliveredAt: null },
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
      where: { id: recipient.id, readAt: null },
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
