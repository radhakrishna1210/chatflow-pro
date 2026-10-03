import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import { decrypt } from '../lib/encryption.js';
import { downloadPhoneMedia } from '../lib/meta.js';
import { transcribeAudio } from '../lib/llm.js';
import { storage, keys } from '../lib/storage/index.js';

// WhatsApp media, kept and made useful.
//
// An inbound photo, document or voice note used to be stored as a placeholder
// plus Meta's media id, and nothing ever fetched the bytes: Meta deletes them
// after ~30 days, the inbox could not show them at all, and a voice note — a
// customer *saying* what they wanted — never reached a keyword trigger, a
// workflow or the AI agent (CF-224).
//
// Now every media message is downloaded and archived to file storage
// (lib/storage), and a voice note is transcribed so the automation can answer
// what was said. Every step degrades: a failed download leaves the media
// re-fetchable by id; a failed or unavailable transcription routes the message
// as an audio message (the workflow `media` trigger) instead of as text.

// Media types the inbox may show inline. Anything else (a customer can send
// any file as a "document") is served as a download so it never renders as a
// page on this origin.
const INLINE_TYPES = /^(image\/(jpeg|png|webp|gif)|audio\/[\w.+-]+|video\/(mp4|3gpp)|application\/pdf)$/i;

const baseType = (mime) => String(mime || '').split(';')[0].trim().toLowerCase();

/**
 * Downloads one media object from Meta and writes it to storage under the
 * message's key. Returns the bytes even when the storage write fails (a voice
 * note can still be transcribed), or null when the download itself failed.
 */
export async function archiveInboundMedia({ workspaceId, messageId, mediaId, mimeType, accessToken }) {
  let downloaded;
  try {
    downloaded = await downloadPhoneMedia({ mediaId, accessToken, maxBytes: env.MEDIA_ARCHIVE_MAX_BYTES });
  } catch (err) {
    console.warn(`[InboundMedia] Media ${mediaId} of message ${messageId} not downloaded: ${err.message}`);
    return null;
  }
  const contentType = mimeType || downloaded.mimeType;
  const key = keys.messageMedia(workspaceId, messageId);
  let stored = false;
  try {
    await storage.put(key, downloaded.buffer, { contentType: baseType(contentType) || 'application/octet-stream' });
    await prisma.message.update({
      where: { id: messageId },
      data: {
        mediaStorageKey: key,
        mediaSize: downloaded.buffer.length,
        ...(mimeType ? {} : { mediaMimeType: contentType }),
      },
    });
    stored = true;
  } catch (err) {
    console.warn(`[InboundMedia] Media of message ${messageId} downloaded but not archived: ${err.message}`);
  }
  return { buffer: downloaded.buffer, mimeType: contentType, key: stored ? key : null };
}

export async function transcribeVoiceNote({ buffer, mimeType }) {
  if (!env.VOICE_TRANSCRIPTION) return { text: null, reason: 'disabled' };
  try {
    return await transcribeAudio(buffer, mimeType);
  } catch (err) {
    console.error('[InboundMedia] Transcription threw:', err.message);
    return { text: null, reason: 'failed' };
  }
}

/**
 * The inbound pipeline's media step (services/webhook.service.js).
 *
 * Voice notes are handled before automation runs, because the transcript is
 * what the automation answers; any other media is archived in the background
 * so a large video does not hold up the reply.
 *
 * @returns {Promise<{ transcript: string|null, reason?: string, archived?: Promise }>}
 */
export async function processInboundMedia({ workspaceId, messageId, parsed, waNumber }) {
  const mediaId = parsed?.media?.mediaId;
  if (!mediaId) return { transcript: null };

  let accessToken;
  try {
    accessToken = decrypt(waNumber.encryptedAccessToken);
  } catch (err) {
    console.warn(`[InboundMedia] Cannot read the access token of number ${waNumber?.id}: ${err.message}`);
    return { transcript: null, reason: 'no_token' };
  }
  const job = archiveInboundMedia({
    workspaceId, messageId, mediaId, mimeType: parsed.media.mediaMimeType, accessToken,
  });

  if (parsed.type !== 'AUDIO') {
    return { transcript: null, archived: job.catch(() => null) };
  }

  const archived = await job;
  if (!archived) return { transcript: null, reason: 'download_failed' };

  const { text, reason } = await transcribeVoiceNote(archived);
  if (!text) {
    console.log(`[InboundMedia] Voice note ${messageId} not transcribed (${reason}) — routed as an audio message.`);
    return { transcript: null, reason };
  }
  try {
    // The transcript becomes the body, the way a caption is for a photo: it is
    // the customer's own words. `transcript` records that a machine wrote it.
    await prisma.message.update({ where: { id: messageId }, data: { transcript: text, body: text } });
  } catch (err) {
    console.warn(`[InboundMedia] Transcript of ${messageId} not saved: ${err.message}`);
  }
  console.log(`[InboundMedia] Voice note ${messageId} transcribed (${text.length} chars).`);
  return { transcript: text };
}

// Archives the bytes of a file an agent sent from the inbox. Best effort: the
// send has already happened.
export async function archiveOutboundMedia({ workspaceId, messageId, buffer, mimeType }) {
  const key = keys.messageMedia(workspaceId, messageId);
  try {
    await storage.put(key, buffer, { contentType: baseType(mimeType) || 'application/octet-stream' });
    await prisma.message.update({ where: { id: messageId }, data: { mediaStorageKey: key, mediaSize: buffer.length } });
    return key;
  } catch (err) {
    console.warn(`[InboundMedia] Sent media of message ${messageId} not archived: ${err.message}`);
    return null;
  }
}

function notFound(message = 'This message has no media to show') {
  const e = new Error(message);
  e.status = 404;
  e.expose = true;
  return e;
}

/**
 * The media of one message, for the inbox: from storage when archived,
 * otherwise re-fetched from Meta by id (and archived on the way through).
 *
 * @returns {Promise<{ stream?: import('stream').Readable, buffer?: Buffer, size: number|null,
 *   contentType: string, filename: string, inline: boolean }>}
 */
export async function getMessageMedia(workspaceId, conversationId, messageId) {
  const message = await prisma.message.findFirst({
    where: { id: messageId, conversationId, conversation: { workspaceId } },
    select: {
      id: true, type: true, mediaId: true, mediaMimeType: true, mediaFilename: true, mediaStorageKey: true,
      conversation: { select: { waNumber: { select: { id: true, encryptedAccessToken: true } } } },
    },
  });
  if (!message) throw notFound('Message not found');

  const describe = (contentType) => {
    const type = baseType(contentType) || 'application/octet-stream';
    return {
      contentType: type,
      filename: message.mediaFilename || `${String(message.type || 'media').toLowerCase()}-${message.id}`,
      inline: INLINE_TYPES.test(type),
    };
  };

  if (message.mediaStorageKey) {
    const obj = await storage.get(message.mediaStorageKey);
    if (obj) return { stream: obj.stream, size: obj.size ?? null, ...describe(message.mediaMimeType || obj.contentType) };
  }

  const waNumber = message.conversation?.waNumber;
  if (!message.mediaId || !waNumber) throw notFound();
  let accessToken;
  try {
    accessToken = decrypt(waNumber.encryptedAccessToken);
  } catch {
    throw notFound('The WhatsApp number this media arrived on can no longer be read — reconnect it.');
  }
  const archived = await archiveInboundMedia({
    workspaceId, messageId: message.id, mediaId: message.mediaId, mimeType: message.mediaMimeType, accessToken,
  });
  if (!archived) throw notFound('WhatsApp no longer has this media (it keeps files for about 30 days).');
  return { buffer: archived.buffer, size: archived.buffer.length, ...describe(archived.mimeType) };
}
