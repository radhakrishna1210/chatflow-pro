import { prisma } from '../lib/prisma.js';
import { decrypt } from '../lib/encryption.js';
import { sendTextMessage, sendButtonMessage, sendListMessage, INTERACTIVE_LIMITS } from '../lib/meta.js';
import { isOptedOut } from './optout.service.js';
import { getWindowState, WINDOW_MS } from './messagingWindow.js';
import { consumeMessageCredit, releaseMessageCredit } from './subscription.service.js';

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
// worker, workflow "send message" steps, forms, sequences) needs the same
// things: decrypt the number's token, meter the send against the workspace's
// quota/wallet, send via Meta, then persist the outbound message so it shows up
// in the inbox. This used to be inlined in webhook.service.js; pulling it out
// is what lets the workers reply from outside the webhook request.
//
// Returns { ok: true, message } or { ok: false, code, detail }, where `code` is
// one of EMPTY, NO_NUMBER, OPTED_OUT, WINDOW_CLOSED, NO_CREDIT, META_REJECTED.
/**
 * @param {string[]} [options] tappable choices to offer with the text. One to
 *   three are sent as reply buttons; four to ten as a list. More than ten is
 *   more than WhatsApp will show, so the extras are dropped rather than
 *   silently turning the whole send into a Meta error.
 * @param {boolean} [recordFailure] also store a FAILED message row when Meta
 *   rejects the send, so the thread shows what did not go out.
 */
export async function deliverAutomatedReply({
  conversationId, waNumberId, toPhone, body, options, recordFailure = false, reason = 'Automated reply',
}) {
  const text = String(body || '').trim();
  if (!text) return { ok: false, code: 'EMPTY', detail: 'Message was empty' };

  const choices = (Array.isArray(options) ? options : [])
    .map((o) => String(typeof o === 'string' ? o : o?.title ?? '').trim())
    .filter(Boolean)
    .slice(0, INTERACTIVE_LIMITS.rowCount);

  const waNumber = waNumberId ? await prisma.waNumber.findUnique({ where: { id: waNumberId } }) : null;
  if (!waNumber) {
    console.warn(`[Outbound] No WaNumber ${waNumberId} — reply dropped.`);
    return { ok: false, code: 'NO_NUMBER', detail: 'No connected WhatsApp number' };
  }
  const { workspaceId } = waNumber;

  // Opt-out applies to every automated path that funnels through here.
  if (await isOptedOut(workspaceId, toPhone)) {
    console.log(`[Outbound] ${toPhone} has opted out — automated reply suppressed.`);
    return { ok: false, code: 'OPTED_OUT', detail: 'Recipient opted out' };
  }

  // WhatsApp only permits a free-form message inside the 24-hour customer
  // service window. Every automated reply here is free-form text, so outside
  // the window Meta rejects it (error 131047). Checking first means the reason
  // is logged and no credit is taken for a message that was never eligible.
  const windowState = await getWindowState(conversationId);
  if (!windowState.open) {
    console.warn(
      `[Outbound] Reply to ${toPhone} suppressed — the 24-hour window closed`
      + `${windowState.lastInboundAt ? ` at ${new Date(windowState.lastInboundAt.getTime() + WINDOW_MS).toISOString()}` : ' (no inbound message on record)'}.`
      + ' Only an approved template can be sent now.',
    );
    return {
      ok: false,
      code: 'WINDOW_CLOSED',
      detail: 'The 24-hour customer service window is closed; only an approved template can be sent',
    };
  }

  // Automated sends draw on the same plan quota and wallet as an inbox reply
  // (README §12.2). They used to bypass it entirely, so a Free workspace could
  // send unlimited automated messages past its quota. Fails closed: a send
  // that cannot be metered is not sent.
  let credit;
  try {
    credit = await consumeMessageCredit(workspaceId, { reason });
  } catch (err) {
    console.error(`[Outbound] Could not meter the send for workspace ${workspaceId}:`, err.message);
    credit = { ok: false };
  }
  if (!credit?.ok) {
    console.warn(`[Outbound] Reply to ${toPhone} not sent — ${credit?.code ?? 'billing unavailable'}.`);
    return { ok: false, code: 'NO_CREDIT', detail: 'Message quota and wallet balance exhausted' };
  }
  const refund = () => releaseMessageCredit(workspaceId, { source: credit.source, amount: credit.amount ?? null })
    .catch((err) => console.error('[Outbound] Credit refund failed:', err.message));

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
    // Nothing went out, so the credit taken above is handed back.
    await refund();
    // A dead phone number id (100/33) or an expired token (190) is a standing
    // fault, not a one-off — mark the number so the UI can say so instead of
    // every reply failing invisibly from here on.
    if (meta && (Number(meta.code) === 190 || (Number(meta.code) === 100 && Number(meta.error_subcode) === 33))) {
      await markNumberUnreachable(waNumber.id, meta).catch((err) => console.warn(`[Outbound] Could not mark number ${waNumber.id} unreachable:`, err.message));
    }
    const detail = String(meta?.message || err.message || 'Meta rejected the send').slice(0, 500);
    if (recordFailure) {
      await prisma.message.create({
        data: {
          conversationId,
          body: text,
          direction: 'OUTBOUND',
          type: 'TEXT',
          status: 'FAILED',
          statusAt: new Date(),
          errorCode: Number.isFinite(Number(meta?.code)) ? Number(meta.code) : null,
          errorMessage: detail,
          sentAt: new Date(),
        },
      }).catch((e) => console.error('[Outbound] Could not record the failed send:', e.message));
    }
    return { ok: false, code: 'META_REJECTED', detail };
  }
  if (!result) {
    await refund();
    return { ok: false, code: 'META_REJECTED', detail: 'Meta returned no result' };
  }
  console.log(`[Outbound] Sent to ${toPhone} via ${waNumber.metaPhoneNumberId} — wamid=${result?.messages?.[0]?.id ?? '?'}`);

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

  return { ok: true, message };
}

// The original contract, kept for the callers that only need to know whether
// something went out: the stored message, or null.
export async function sendAutomatedReply(args) {
  const outcome = await deliverAutomatedReply(args);
  return outcome.ok ? outcome.message : null;
}
