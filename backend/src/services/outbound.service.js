import { prisma } from '../lib/prisma.js';
import { decrypt } from '../lib/encryption.js';
import { sendTextMessage, sendButtonMessage, sendListMessage, INTERACTIVE_LIMITS } from '../lib/meta.js';
import { isOptedOut } from './optout.service.js';
import { getWindowState, WINDOW_MS } from './messagingWindow.js';

// Records that Meta has stopped accepting this number, so the fault is visible
// on the Number Setup screen rather than only in the log. Two numbers in the
// live database already answer 100/33 ("does not exist") and nothing surfaced
// it — every send from them simply failed.
export async function markNumberUnreachable(waNumberId, metaError) {
  const reason = Number(metaError?.code) === 190
    ? 'The access token for this number has expired. Reconnect it to keep sending.'
    : 'WhatsApp no longer recognises this phone number ID. It may have been moved to another WhatsApp Business Account, or removed. Reconnect the number.';
  await prisma.waNumber.updateMany({
    // updateMany with the guard keeps the first observation's timestamp rather
    // than resetting it on every subsequent failure.
    where: { id: waNumberId, unreachableSince: null },
    data: { unreachableSince: new Date(), unreachableReason: reason },
  });
}

// Every automated reply path (keyword triggers, welcome/OOO, the delayed
// worker, workflow "send message" steps, forms) needs the same three things:
// decrypt the number's token, send via Meta, then persist the outbound message
// so it shows up in the inbox. This used to be inlined in webhook.service.js;
// pulling it out is what lets the workflow worker reply from outside the
// webhook request.
/**
 * @param {string[]} [options] tappable choices to offer with the text. One to
 *   three are sent as reply buttons; four to ten as a list. More than ten is
 *   more than WhatsApp will show, so the extras are dropped rather than
 *   silently turning the whole send into a Meta error.
 */
export async function sendAutomatedReply({ conversationId, waNumberId, toPhone, body, options }) {
  const text = String(body || '').trim();
  if (!text) return null;

  const choices = (Array.isArray(options) ? options : [])
    .map((o) => String(typeof o === 'string' ? o : o?.title ?? '').trim())
    .filter(Boolean)
    .slice(0, INTERACTIVE_LIMITS.rowCount);

  const waNumber = await prisma.waNumber.findUnique({ where: { id: waNumberId } });
  if (!waNumber) {
    console.warn(`[Outbound] No WaNumber ${waNumberId} — reply dropped.`);
    return null;
  }

  // Opt-out applies to every automated path that funnels through here:
  // keyword triggers, welcome/OOO/delayed replies, workflow "send message"
  // steps and form prompts.
  if (await isOptedOut(waNumber.workspaceId, toPhone)) {
    console.log(`[Outbound] ${toPhone} has opted out — automated reply suppressed.`);
    return null;
  }

  // WhatsApp only permits a free-form message inside the 24-hour customer
  // service window. Every automated reply here is free-form text, so outside
  // the window Meta rejects it (error 131047) — and this function's `return
  // null` turned that into silence. Checking first means the reason is at
  // least logged and, for a keyword trigger the customer is waiting on, it is
  // clear the message was never eligible rather than lost.
  const windowState = await getWindowState(conversationId);
  if (!windowState.open) {
    console.warn(
      `[Outbound] Reply to ${toPhone} suppressed — the 24-hour window closed`
      + `${windowState.lastInboundAt ? ` at ${new Date(windowState.lastInboundAt.getTime() + WINDOW_MS).toISOString()}` : ' (no inbound message on record)'}.`
      + ' Only an approved template can be sent now.',
    );
    return null;
  }

  let result;
  try {
    const accessToken = decrypt(waNumber.encryptedAccessToken);
    if (choices.length === 0) {
      result = await sendTextMessage(waNumber.metaPhoneNumberId, accessToken, toPhone, text);
    } else if (choices.length <= INTERACTIVE_LIMITS.buttonCount) {
      result = await sendButtonMessage(waNumber.metaPhoneNumberId, accessToken, toPhone,
        { body: text, buttons: choices });
    } else {
      result = await sendListMessage(waNumber.metaPhoneNumberId, accessToken, toPhone,
        { body: text, rows: choices });
    }
  } catch (err) {
    const meta = err?.response?.data?.error;
    console.error('[Outbound] Meta send failed:', meta || err.message);
    // A dead phone number id (100/33) or an expired token (190) is a standing
    // fault, not a one-off — mark the number so the UI can say so instead of
    // every reply failing invisibly from here on.
    if (meta && (Number(meta.code) === 190 || (Number(meta.code) === 100 && Number(meta.error_subcode) === 33))) {
      await markNumberUnreachable(waNumber.id, meta).catch(() => {});
    }
    return null;
  }
  if (!result) return null;

  // The inbox renders message.body, so the options are recorded with it —
  // otherwise the agent reading the thread sees the question and no sign of
  // what the customer was actually offered.
  const stored = choices.length === 0
    ? text
    : [text, '', ...choices.map((c) => `• ${c}`)].join('\n');

  const message = await prisma.message.create({
    data: {
      conversationId,
      body: stored,
      direction: 'OUTBOUND',
      type: 'TEXT',
      metaMessageId: result?.messages?.[0]?.id,
      status: 'SENT',
      statusAt: new Date(),
      sentAt: new Date(),
    },
  });

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { lastMessageAt: new Date() },
  });

  return message;
}
