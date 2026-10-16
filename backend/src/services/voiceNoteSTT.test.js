import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { cleanAudioMime } from './stt.service.js';
import { parseInboundMessage, carriesCustomerText, PLACEHOLDER } from './inboundMessage.js';

test('cleanAudioMime normalises WhatsApp audio mime types', () => {
  assert.equal(cleanAudioMime('audio/ogg; codecs=opus'), 'audio/ogg');
  assert.equal(cleanAudioMime('audio/ogg'), 'audio/ogg');
  assert.equal(cleanAudioMime('audio/opus'), 'audio/ogg');
  assert.equal(cleanAudioMime('audio/mp3'), 'audio/mp3');
  assert.equal(cleanAudioMime('audio/mpeg'), 'audio/mp3');
  assert.equal(cleanAudioMime('audio/mp4'), 'audio/mp4');
  assert.equal(cleanAudioMime('audio/m4a'), 'audio/mp4');
  assert.equal(cleanAudioMime('audio/wav'), 'audio/wav');
});

test('parseInboundMessage parses audio voice note correctly', () => {
  const metaMsg = {
    from: '919876543210',
    id: 'wamid.HBgL12345',
    timestamp: '1710000000',
    type: 'audio',
    audio: {
      id: 'media_audio_999',
      mime_type: 'audio/ogg; codecs=opus',
      sha256: 'abc123sha',
      voice: true,
    },
  };

  const parsed = parseInboundMessage(metaMsg);
  assert.equal(parsed.type, 'AUDIO');
  assert.equal(parsed.body, PLACEHOLDER.AUDIO);
  assert.equal(parsed.media.mediaId, 'media_audio_999');
  assert.equal(parsed.media.mediaMimeType, 'audio/ogg; codecs=opus');
  assert.equal(parsed.media.voice, true);
});

test('carriesCustomerText recognises transcribed voice note as customer text', () => {
  // Untranscribed voice note: only holds placeholder string
  const untranscribed = {
    type: 'AUDIO',
    body: PLACEHOLDER.AUDIO,
    media: { mediaId: '123' },
  };
  assert.equal(carriesCustomerText(untranscribed), false, 'Untranscribed voice note should not trigger text matches');

  // Transcribed voice note: holds spoken words
  const transcribed = {
    type: 'AUDIO',
    body: 'I need information about your pricing',
    transcription: 'I need information about your pricing',
    media: { mediaId: '123' },
  };
  assert.equal(carriesCustomerText(transcribed), true, 'Transcribed voice note represents customer words');

  // Standard text message
  const textMsg = { type: 'TEXT', body: 'Hello' };
  assert.equal(carriesCustomerText(textMsg), true);

  // Photo without caption
  const photo = { type: 'IMAGE', body: PLACEHOLDER.IMAGE };
  assert.equal(carriesCustomerText(photo), false);
});
