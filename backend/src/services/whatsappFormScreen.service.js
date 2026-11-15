// A WhatsApp Form shown as one screen (a WhatsApp Flow) instead of one
// question per message. lib/formFlowScreen.js turns the form's questions into
// the screen and a submitted screen back into answers; this module publishes
// the screen to Meta, sends it when the form's keyword arrives, and files the
// answers when the customer taps Submit.
//
// The chat version of the form is never taken away. Whenever the screen
// cannot be used (not published, out of date, switched off, a number on
// another WhatsApp account, the send fails), the form asks its questions one
// message at a time exactly as before.

import { prisma } from '../lib/prisma.js';
import { decrypt } from '../lib/encryption.js';
import {
  createFlow, uploadFlowJson, publishFlow, deprecateFlow, deleteFlow, sendFlowMessage,
} from '../lib/meta.js';
import {
  buildFlowJson, flowFingerprint, answersFromFlowReply, FLOW_SCREEN_ID,
} from '../lib/formFlowScreen.js';
import { isOptedOut } from './optout.service.js';
import { getWindowState } from './messagingWindow.js';
import { sendAutomatedReply } from './outbound.service.js';
import { completeSubmission, SCREEN_KEY } from './whatsappForms.service.js';
import { stockFor, shortfallLines, addToWaitlist } from './whatsappFormStock.service.js';

const schemaOf = (form) => (Array.isArray(form?.schema) ? form.schema : []);

function fail(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

// The row for a form, or null. Never throws: a database that has not run the
// WhatsappFormScreen migration yet answers "no screen", and the form carries
// on the chat way.
async function findScreen(formId) {
  try {
    return await prisma.whatsappFormScreen.findUnique({ where: { formId } });
  } catch (err) {
    console.warn(`[FormScreen] Could not read the screen for form ${formId}: ${String(err.message).split('\n')[0]}`);
    return null;
  }
}

// The fingerprint of the screen this form would produce now, or the reason it
// cannot be shown as one screen.
function describeForm(form) {
  try {
    return { fingerprint: flowFingerprint(form), reason: null };
  } catch (err) {
    return { fingerprint: null, reason: err.message };
  }
}

// What Meta said, in words fit for the form's author.
function metaMessage(err) {
  const meta = err?.response?.data?.error;
  if (meta) return meta.error_user_msg || meta.error_user_title || meta.message || 'WhatsApp refused the request.';
  return err?.message || 'Something went wrong talking to WhatsApp.';
}

async function loadForm(workspaceId, formId) {
  const form = await prisma.whatsappForm.findFirst({ where: { id: formId, workspaceId } });
  if (!form) throw fail(404, 'Form not found');
  return form;
}

/**
 * The form screen's state, for the form editor.
 *   supported  can this form be shown as one screen at all
 *   published  a screen exists on WhatsApp
 *   upToDate   …and it was built from the form's current questions
 *   live       customers who send the keyword get the screen right now
 */
export async function getScreenState(workspaceId, formId) {
  const form = await loadForm(workspaceId, formId);
  const { fingerprint, reason } = describeForm(form);
  const row = await findScreen(formId);
  const published = row?.status === 'PUBLISHED' && Boolean(row.metaFlowId);
  const upToDate = published && fingerprint !== null && row.fingerprint === fingerprint;
  return {
    supported: fingerprint !== null,
    reason,
    published,
    upToDate,
    enabled: row?.enabled === true,
    live: upToDate && row.enabled === true && form.status === 'Active',
    error: row?.error ?? null,
    publishedAt: row?.publishedAt ?? null,
  };
}

// Flow names must be unique on the WhatsApp account, and a changed form is
// published as a new Flow, so each publish gets its own suffix.
const flowName = (form) => `${String(form.name || 'Form').trim().slice(0, 60)} ${Date.now().toString(36)}`;

/**
 * Publishes the form's current questions as a screen and turns it on.
 * A published Flow cannot be edited, so every publish creates a new one and
 * retires the previous.
 */
export async function publishScreen(workspaceId, formId) {
  const form = await loadForm(workspaceId, formId);
  const flowJson = buildFlowJson(form); // 400 with a readable reason when the form does not fit
  const fingerprint = flowFingerprint(form);

  const waNumber = await prisma.waNumber.findFirst({
    where: { workspaceId, status: 'ACTIVE', unreachableSince: null },
    orderBy: { createdAt: 'asc' },
  });
  if (!waNumber) throw fail(400, 'Connect a WhatsApp number before turning on the form screen.');
  const accessToken = decrypt(waNumber.encryptedAccessToken);

  const previous = await findScreen(formId);

  let flowId = null;
  try {
    flowId = (await createFlow(waNumber.wabaId, accessToken, { name: flowName(form) }))?.id;
    if (!flowId) throw new Error('WhatsApp did not return a flow id.');

    const upload = await uploadFlowJson(flowId, accessToken, flowJson);
    const problems = Array.isArray(upload?.validation_errors) ? upload.validation_errors : [];
    if (problems.length) {
      throw new Error(`WhatsApp did not accept the screen: ${problems.map((p) => p.message || p.error).filter(Boolean).slice(0, 3).join(' ')}`);
    }

    await publishFlow(flowId, accessToken);
  } catch (err) {
    const message = metaMessage(err);
    console.error(`[FormScreen] Publishing form ${formId} failed: ${message}`);
    // Never leave a half-made draft behind on the account.
    if (flowId) await deleteFlow(flowId, accessToken).catch(() => {});
    // The earlier screen, if any, is left exactly as it was.
    await prisma.whatsappFormScreen.upsert({
      where: { formId },
      create: { workspaceId, formId, wabaId: waNumber.wabaId, status: 'FAILED', enabled: true, error: message },
      update: { error: message },
    });
    throw fail(err.status === 400 ? 400 : 502, message);
  }

  await prisma.whatsappFormScreen.upsert({
    where: { formId },
    create: {
      workspaceId, formId, wabaId: waNumber.wabaId, metaFlowId: flowId,
      status: 'PUBLISHED', enabled: true, fingerprint, error: null, publishedAt: new Date(),
    },
    update: {
      wabaId: waNumber.wabaId, metaFlowId: flowId,
      status: 'PUBLISHED', enabled: true, fingerprint, error: null, publishedAt: new Date(),
    },
  });

  if (previous?.metaFlowId && previous.metaFlowId !== flowId) {
    await deprecateFlow(previous.metaFlowId, accessToken).catch((err) =>
      console.warn(`[FormScreen] Could not retire flow ${previous.metaFlowId}: ${metaMessage(err)}`));
  }

  return getScreenState(workspaceId, formId);
}

/** Switches a published screen on or off without touching WhatsApp. */
export async function setScreenEnabled(workspaceId, formId, enabled) {
  if (typeof enabled !== 'boolean') throw fail(400, 'enabled must be true or false');
  await loadForm(workspaceId, formId);
  const row = await findScreen(formId);
  if (!row) throw fail(400, 'Publish the form screen first.');
  await prisma.whatsappFormScreen.update({ where: { formId }, data: { enabled } });
  return getScreenState(workspaceId, formId);
}

/**
 * After a form is edited: if its screen is on and the questions changed,
 * publish the new questions. Never throws — a failed republish is recorded on
 * the screen (and the form falls back to chat) rather than failing the save.
 */
export async function republishIfStale(workspaceId, formId) {
  try {
    const row = await findScreen(formId);
    if (!row || !row.enabled || row.status !== 'PUBLISHED') return;
    const form = await prisma.whatsappForm.findFirst({ where: { id: formId, workspaceId } });
    if (!form) return;
    const { fingerprint, reason } = describeForm(form);
    if (fingerprint === null) {
      await prisma.whatsappFormScreen.update({ where: { formId }, data: { error: reason } });
      return;
    }
    if (fingerprint === row.fingerprint) return;
    await publishScreen(workspaceId, formId);
  } catch (err) {
    console.error(`[FormScreen] Republishing form ${formId} failed: ${err.message}`);
  }
}

// The token a screen is sent with: the submission it will complete, plus the
// start of the fingerprint of the questions it was built from. The second half
// is how a screen sent before the form was edited is recognised when it
// finally comes back.
const tokenFor = (submissionId, fingerprint) => `${submissionId}.${String(fingerprint).slice(0, 12)}`;
const parseToken = (token) => {
  const [submissionId, stamp = ''] = String(token || '').split('.');
  return { submissionId, stamp };
};

const OPENING = 'Tap the button below, fill in the form and tap Submit.';

/**
 * Sends the form as a screen for a submission that has just been opened.
 * Returns true when the screen went out; false means "ask the first question
 * in chat instead", for any reason at all.
 */
export async function startOnScreen({ form, submission, conversation, contact }) {
  try {
    const row = await findScreen(form.id);
    if (!row || !row.enabled || row.status !== 'PUBLISHED' || !row.metaFlowId) return false;

    const { fingerprint } = describeForm(form);
    if (fingerprint === null || fingerprint !== row.fingerprint) return false;

    const waNumber = await prisma.waNumber.findUnique({ where: { id: conversation.waNumberId } });
    if (!waNumber || waNumber.wabaId !== row.wabaId) return false;

    if (await isOptedOut(waNumber.workspaceId, contact.phoneNumber)) return false;
    if (!(await getWindowState(conversation.id)).open) return false;

    const body = `${form.name}\n\n${OPENING}`;
    const result = await sendFlowMessage(
      waNumber.metaPhoneNumberId,
      decrypt(waNumber.encryptedAccessToken),
      contact.phoneNumber,
      {
        body,
        cta: 'Open form',
        flowId: row.metaFlowId,
        flowToken: tokenFor(submission.id, fingerprint),
        screen: FLOW_SCREEN_ID,
      },
    );

    // Recorded like every other automated reply, so the inbox shows what the
    // customer was sent.
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        body: `${body}\n\n• Open form`,
        direction: 'OUTBOUND',
        type: 'TEXT',
        metaMessageId: result?.messages?.[0]?.id,
        status: 'SENT',
        statusAt: new Date(),
        sentAt: new Date(),
      },
    });
    await prisma.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: new Date() } });

    // Marks the submission as waiting on the screen rather than on a typed
    // answer to question one.
    await prisma.whatsappFormSubmission.update({
      where: { id: submission.id },
      data: { answers: { [SCREEN_KEY]: true } },
    });
    return true;
  } catch (err) {
    console.error(`[FormScreen] Could not send the screen for form ${form?.id}: ${metaMessage(err)}`);
    return false;
  }
}

/**
 * A customer tapped Submit on a form screen. Files the answers exactly as the
 * chat version would have and sends the closing message. Returns true when the
 * reply was handled (including when it was refused with an explanation).
 */
export async function handleFlowReply({ workspaceId, conversation, contact, flowReply }) {
  if (!conversation?.waNumberId || !contact) return false;

  const reply = (text) => sendAutomatedReply({
    conversationId: conversation.id,
    waNumberId: conversation.waNumberId,
    toPhone: contact.phoneNumber,
    body: text,
  });

  const { submissionId, stamp } = parseToken(flowReply?.token);
  if (!submissionId) return false;

  const submission = await prisma.whatsappFormSubmission.findFirst({
    where: { id: submissionId, workspaceId },
    include: { form: true },
  });
  // Not one of ours (a Flow sent from somewhere else), or someone else's.
  if (!submission?.form) return false;
  if (submission.contactId && submission.contactId !== contact.id) return false;

  const form = submission.form;
  const fields = schemaOf(form);
  const restart = form.keyword ? ` Send ${form.keyword} to start again.` : '';

  if (form.status !== 'Active' || fields.length === 0) {
    await reply(`This form is no longer available.`);
    return true;
  }

  // The screen was built from questions that have since changed, so its
  // inputs cannot be read against the form as it is now.
  const { fingerprint } = describeForm(form);
  if (fingerprint === null || !stamp || !fingerprint.startsWith(stamp)) {
    await reply(`This form has been updated since it was sent to you.${restart}`);
    return true;
  }

  const { answers, problems } = answersFromFlowReply(fields, flowReply?.data);
  if (problems.length) {
    await reply(`Some answers are missing:\n${problems.map((p) => `• ${p}`).join('\n')}\n\nOpen the form again, fill them in and tap Submit.`);
    return true;
  }

  // Today's stock (services/whatsappFormStock.service.js). The screen was
  // opened some time ago, so what is left is checked now, at Submit.
  const stock = await stockFor(form);
  if (stock.soldOut) {
    await reply(stock.message);
    await addToWaitlist(contact.id);
    return true;
  }
  const short = shortfallLines(stock, fields, answers);
  if (short.length) {
    await reply(`Sorry, we do not have that much left today:\n${short.map((s) => `• ${s}`).join('\n')}\n\nOpen the form again, change the quantity and tap Submit.`);
    return true;
  }

  // The same screen submitted a second time is a second response, not an edit
  // of the first: the first has already been confirmed to the customer.
  let target = submission;
  if (submission.completed && !submission.answers?.[SCREEN_KEY]) {
    target = await prisma.whatsappFormSubmission.create({
      data: {
        workspaceId, formId: form.id, contactId: contact.id, conversationId: conversation.id,
        answers: {}, cursor: 0,
      },
    });
  }

  await completeSubmission({ workspaceId, submission: target, form, fields, contact, answers, reply });
  return true;
}
