import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// The media step of the inbound pipeline: archive every media message, and
// turn a voice note into text the automation can answer — degrading to "an
// audio message arrived" whenever any part of that is unavailable (CF-224).
// Meta, Gemini and the token decryption are faked; storage is in memory.
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/offline';

let download = async () => ({ buffer: Buffer.from('OggS-voice'), mimeType: 'audio/ogg', sha256: null });
const downloads = [];
mock.module('../lib/meta.js', {
  namedExports: {
    downloadPhoneMedia: async (args) => { downloads.push(args); return download(args); },
  },
});
let transcribe = async () => ({ text: 'where is my order' });
const transcriptions = [];
mock.module('../lib/llm.js', {
  namedExports: {
    transcribeAudio: async (buffer, mimeType) => { transcriptions.push({ buffer, mimeType }); return transcribe(buffer, mimeType); },
  },
});
let decryptFails = false;
mock.module('../lib/encryption.js', {
  namedExports: { decrypt: () => { if (decryptFails) throw new Error('bad key'); return 'token'; } },
});

const { prisma } = await import('../lib/prisma.js');
const { env } = await import('../config/env.js');
const { setStorage } = await import('../lib/storage/index.js');
const {
  processInboundMedia, archiveOutboundMedia, getMessageMedia,
} = await import('./inboundMedia.service.js');

// In-memory storage driver with a switchable failure.
const objects = new Map();
let putFails = false;
setStorage({
  driver: 'memory',
  objectStore: true,
  put: async (key, buf, { contentType } = {}) => {
    if (putFails) throw new Error('bucket down');
    objects.set(key, { buf: Buffer.from(buf), contentType });
    return { key, size: buf.length };
  },
  get: async (key) => {
    const o = objects.get(key);
    if (!o) return null;
    const { Readable } = await import('node:stream');
    return { stream: Readable.from([o.buf]), size: o.buf.length, contentType: o.contentType };
  },
  getBuffer: async (key) => objects.get(key)?.buf ?? null,
  head: async () => null,
  delete: async (key) => { objects.delete(key); },
  signedUrl: async () => null,
  describe: () => 'memory',
});

const updates = [];
prisma.message.update = async ({ where, data }) => { updates.push({ id: where.id, ...data }); return { id: where.id, ...data }; };
let messageRow = null;
prisma.message.findFirst = async ({ where }) => (messageRow && messageRow.id === where.id
  && where.conversation?.workspaceId === 'ws_1' ? structuredClone(messageRow) : null);

const waNumber = { id: 'wa_1', encryptedAccessToken: 'enc' };
const voice = { type: 'AUDIO', body: '[voice message]', media: { mediaId: 'mid_1', mediaMimeType: 'audio/ogg; codecs=opus' } };
const photo = { type: 'IMAGE', body: '[photo]', media: { mediaId: 'mid_2', mediaMimeType: 'image/jpeg' } };

function reset() {
  downloads.length = 0; transcriptions.length = 0; updates.length = 0; objects.clear();
  putFails = false; decryptFails = false; messageRow = null;
  download = async () => ({ buffer: Buffer.from('OggS-voice'), mimeType: 'audio/ogg', sha256: null });
  transcribe = async () => ({ text: 'where is my order' });
  env.VOICE_TRANSCRIPTION = true;
}

test('a voice note is archived, transcribed, and the transcript becomes the body', async () => {
  reset();
  const out = await processInboundMedia({ workspaceId: 'ws_1', messageId: 'm_1', parsed: voice, waNumber });

  assert.equal(out.transcript, 'where is my order');
  assert.equal(downloads[0].mediaId, 'mid_1');
  assert.equal(downloads[0].accessToken, 'token');
  assert.equal(objects.get('workspaces/ws_1/messages/m_1').buf.toString(), 'OggS-voice');
  assert.equal(objects.get('workspaces/ws_1/messages/m_1').contentType, 'audio/ogg');
  assert.equal(transcriptions[0].mimeType, 'audio/ogg; codecs=opus');
  assert.deepEqual(updates.find((u) => u.transcript), { id: 'm_1', transcript: 'where is my order', body: 'where is my order' });
  assert.equal(updates.find((u) => u.mediaStorageKey).mediaStorageKey, 'workspaces/ws_1/messages/m_1');
});

test('no Gemini key: archived, not transcribed, routed as audio', async () => {
  reset();
  transcribe = async () => ({ text: null, reason: 'not_configured' });
  const out = await processInboundMedia({ workspaceId: 'ws_1', messageId: 'm_1', parsed: voice, waNumber });
  assert.deepEqual(out, { transcript: null, reason: 'not_configured' });
  assert.ok(objects.has('workspaces/ws_1/messages/m_1'));
  assert.ok(!updates.some((u) => 'transcript' in u), 'nothing claims a transcript');
});

test('transcription failing or throwing degrades the same way', async () => {
  reset();
  transcribe = async () => ({ text: null, reason: 'failed' });
  assert.equal((await processInboundMedia({ workspaceId: 'ws_1', messageId: 'm_1', parsed: voice, waNumber })).reason, 'failed');
  transcribe = async () => { throw new Error('boom'); };
  assert.equal((await processInboundMedia({ workspaceId: 'ws_1', messageId: 'm_1', parsed: voice, waNumber })).reason, 'failed');
});

test('VOICE_TRANSCRIPTION=false skips the model entirely', async () => {
  reset();
  env.VOICE_TRANSCRIPTION = false;
  const out = await processInboundMedia({ workspaceId: 'ws_1', messageId: 'm_1', parsed: voice, waNumber });
  assert.deepEqual(out, { transcript: null, reason: 'disabled' });
  assert.equal(transcriptions.length, 0);
});

test('a failed download skips transcription and stores nothing', async () => {
  reset();
  download = async () => { throw new Error('media expired'); };
  const out = await processInboundMedia({ workspaceId: 'ws_1', messageId: 'm_1', parsed: voice, waNumber });
  assert.deepEqual(out, { transcript: null, reason: 'download_failed' });
  assert.equal(transcriptions.length, 0);
  assert.equal(objects.size, 0);
});

test('storage being down does not stop the voice note being transcribed', async () => {
  reset();
  putFails = true;
  const out = await processInboundMedia({ workspaceId: 'ws_1', messageId: 'm_1', parsed: voice, waNumber });
  assert.equal(out.transcript, 'where is my order');
  assert.ok(!updates.some((u) => u.mediaStorageKey), 'no key recorded for an object that was not written');
});

test('an unreadable number token leaves the message as it arrived', async () => {
  reset();
  decryptFails = true;
  const out = await processInboundMedia({ workspaceId: 'ws_1', messageId: 'm_1', parsed: voice, waNumber });
  assert.deepEqual(out, { transcript: null, reason: 'no_token' });
  assert.equal(downloads.length, 0);
});

test('a photo is archived in the background and never transcribed', async () => {
  reset();
  download = async () => ({ buffer: Buffer.from([0xff, 0xd8, 0xff]), mimeType: 'image/jpeg' });
  const out = await processInboundMedia({ workspaceId: 'ws_1', messageId: 'm_2', parsed: photo, waNumber });
  assert.equal(out.transcript, null);
  await out.archived;
  assert.ok(objects.has('workspaces/ws_1/messages/m_2'));
  assert.equal(transcriptions.length, 0);
});

test('a message without media is a no-op', async () => {
  reset();
  assert.deepEqual(await processInboundMedia({ workspaceId: 'ws_1', messageId: 'm_3', parsed: { type: 'TEXT', body: 'hi', media: null }, waNumber }), { transcript: null });
  assert.equal(downloads.length, 0);
});

test('outbound inbox media is archived under the message key', async () => {
  reset();
  const key = await archiveOutboundMedia({ workspaceId: 'ws_1', messageId: 'm_out', buffer: Buffer.from('%PDF'), mimeType: 'application/pdf' });
  assert.equal(key, 'workspaces/ws_1/messages/m_out');
  assert.equal(updates[0].mediaSize, 4);
});

// ── Serving media to the inbox ──────────────────────────────────────────────

const read = async (file) => {
  if (file.buffer) return file.buffer.toString();
  const chunks = [];
  for await (const c of file.stream) chunks.push(c);
  return Buffer.concat(chunks).toString();
};

test('archived media is served from storage with its stored type', async () => {
  reset();
  objects.set('workspaces/ws_1/messages/m_1', { buf: Buffer.from('voice'), contentType: 'audio/ogg' });
  messageRow = { id: 'm_1', type: 'AUDIO', mediaId: 'mid_1', mediaMimeType: 'audio/ogg; codecs=opus', mediaFilename: null, mediaStorageKey: 'workspaces/ws_1/messages/m_1', conversation: { waNumber } };
  const file = await getMessageMedia('ws_1', 'conv_1', 'm_1');
  assert.equal(await read(file), 'voice');
  assert.equal(file.contentType, 'audio/ogg');
  assert.equal(file.inline, true);
  assert.equal(downloads.length, 0);
});

test('media never archived is re-fetched from Meta (and archived on the way)', async () => {
  reset();
  download = async () => ({ buffer: Buffer.from('<html>'), mimeType: 'text/html' });
  messageRow = { id: 'm_9', type: 'DOCUMENT', mediaId: 'mid_9', mediaMimeType: 'text/html', mediaFilename: 'page.html', mediaStorageKey: null, conversation: { waNumber } };
  const file = await getMessageMedia('ws_1', 'conv_1', 'm_9');
  assert.equal(await read(file), '<html>');
  assert.equal(file.inline, false, 'a customer-sent HTML file is a download, never a page on our origin');
  assert.equal(file.filename, 'page.html');
  assert.ok(objects.has('workspaces/ws_1/messages/m_9'));
});

test('another workspace, or media Meta no longer holds, is a 404', async () => {
  reset();
  messageRow = { id: 'm_1', type: 'IMAGE', mediaId: 'mid', mediaMimeType: 'image/png', mediaStorageKey: null, conversation: { waNumber } };
  await assert.rejects(() => getMessageMedia('ws_other', 'conv_1', 'm_1'), (e) => e.status === 404);
  download = async () => { throw new Error('gone'); };
  await assert.rejects(() => getMessageMedia('ws_1', 'conv_1', 'm_1'), (e) => e.status === 404 && /30 days/.test(e.message));
  messageRow = { id: 'm_2', type: 'TEXT', mediaId: null, mediaStorageKey: null, conversation: { waNumber } };
  await assert.rejects(() => getMessageMedia('ws_1', 'conv_1', 'm_2'), (e) => e.status === 404);
});
