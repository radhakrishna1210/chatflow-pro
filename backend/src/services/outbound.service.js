import { prisma } from '../lib/prisma.js';
import { decrypt } from '../lib/encryption.js';
import { sendTextMessage } from '../lib/meta.js';
import { isOptedOut } from './optout.service.js';

// Every automated reply path (keyword triggers, welcome/OOO, the delayed
// worker, workflow "send message" steps, forms) needs the same three things:
// decrypt the number's token, send via Meta, then persist the outbound message
// so it shows up in the inbox. This used to be inlined in webhook.service.js;
// pulling it out is what lets the workflow worker reply from outside the
// webhook request.
export async function sendAutomatedReply({ conversationId, waNumberId, toPhone, body }) {
  const text = String(body || '').trim();
  if (!text) return null;

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

  let result;
  try {
    const accessToken = decrypt(waNumber.encryptedAccessToken);
    result = await sendTextMessage(waNumber.metaPhoneNumberId, accessToken, toPhone, text);
  } catch (err) {
    console.error('[Outbound] Meta send failed:', err?.response?.data || err.message);
    return null;
  }
  if (!result) return null;

  const message = await prisma.message.create({
    data: {
      conversationId,
      body: text,
      direction: 'OUTBOUND',
      metaMessageId: result?.messages?.[0]?.id,
      sentAt: new Date(),
    },
  });

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { lastMessageAt: new Date() },
  });

  return message;
}
