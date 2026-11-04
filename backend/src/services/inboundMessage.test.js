import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInboundMessage, carriesCustomerText } from './inboundMessage.js';

// Every key the parser puts in `media`/`location` is spread straight into
// prisma.message.create, so each must be a real Message column. A stray
// `voice` key made Prisma reject every inbound image, video, audio, document
// and sticker ("Unknown argument `voice`"), dropping them all.
const MESSAGE_MEDIA_COLUMNS = new Set(['mediaId', 'mediaUrl', 'mediaMimeType', 'mediaFilename', 'mediaSha256']);
const MESSAGE_LOCATION_COLUMNS = new Set(['locationLat', 'locationLng', 'locationName']);

for (const type of ['image', 'video', 'audio', 'voice', 'document', 'sticker']) {
  test(`${type} media fields are all Message columns`, () => {
    const parsed = parseInboundMessage({ type, [type]: { id: 'M1', mime_type: 'x/y', sha256: 'h', filename: 'f.pdf', voice: true } });
    assert.ok(parsed.media);
    for (const key of Object.keys(parsed.media)) {
      assert.ok(MESSAGE_MEDIA_COLUMNS.has(key), `unexpected key "${key}" would break the Message insert`);
    }
    assert.equal(parsed.media.mediaId, 'M1');
  });
}

test('voice-note flag is reported outside the media columns', () => {
  const parsed = parseInboundMessage({ type: 'audio', audio: { id: 'A', mime_type: 'audio/ogg', voice: true } });
  assert.equal(parsed.voice, true);
  assert.equal(parsed.type, 'AUDIO');
});

test('location fields are all Message columns', () => {
  const parsed = parseInboundMessage({ type: 'location', location: { latitude: 12.9, longitude: 77.5, name: 'Office' } });
  for (const key of Object.keys(parsed.location)) assert.ok(MESSAGE_LOCATION_COLUMNS.has(key), key);
  assert.equal(parsed.body, 'Office');
});

test('a reaction is described, and never treated as customer text', () => {
  const parsed = parseInboundMessage({ type: 'reaction', reaction: { message_id: 'wamid.x', emoji: '👍' } });
  assert.equal(parsed.type, 'UNSUPPORTED');
  assert.equal(parsed.body, '[reacted 👍]');
  assert.equal(carriesCustomerText(parsed), false);
});

test('interactive replies carry the tapped id as the button payload', () => {
  const parsed = parseInboundMessage({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'cta_1', title: 'Yes' } } });
  assert.equal(parsed.type, 'INTERACTIVE');
  assert.equal(parsed.body, 'Yes');
  assert.equal(parsed.buttonPayload, 'cta_1');
  assert.equal(carriesCustomerText(parsed), true);
});

test('a photo caption is not customer text for automation, a placeholder never is', () => {
  const withCaption = parseInboundMessage({ type: 'image', image: { id: 'I', caption: 'stop' } });
  assert.equal(carriesCustomerText(withCaption), false);
  const unknown = parseInboundMessage({ type: 'order', order: {} });
  assert.equal(unknown.type, 'UNSUPPORTED');
  assert.equal(carriesCustomerText(unknown), false);
});
