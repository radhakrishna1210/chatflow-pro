import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// Voice-note transcription through Gemini, with the SDK faked: the request
// shape, and every way it returns "no transcript" instead of throwing.
const requests = [];
let respond = async () => ({ text: 'hello there' });
mock.module('@google/genai', {
  namedExports: {
    GoogleGenAI: class {
      constructor() {
        this.models = { generateContent: async (req) => { requests.push(req); return respond(req); } };
      }
    },
  },
});

const { env } = await import('../config/env.js');
const { transcribeAudio, TRANSCRIPTION_MAX_BYTES } = await import('./llm.js');

const audio = Buffer.from('OggS fake opus');

function reset({ key = 'test-key' } = {}) {
  requests.length = 0;
  respond = async () => ({ text: 'hello there' });
  env.GEMINI_API_KEY = key;
  env.GEMINI_MODEL = 'main-model';
  env.GEMINI_FALLBACK_MODEL = 'lite-model';
}

test('sends the audio inline with its base type and returns the transcript', async () => {
  reset();
  const out = await transcribeAudio(audio, 'audio/ogg; codecs=opus');
  assert.deepEqual(out, { text: 'hello there' });
  const part = requests[0].contents[0].parts.find((p) => p.inlineData);
  assert.equal(part.inlineData.mimeType, 'audio/ogg');
  assert.equal(Buffer.from(part.inlineData.data, 'base64').toString(), 'OggS fake opus');
  assert.equal(requests[0].model, 'main-model');
});

test('no key configured: not_configured, and no request', async () => {
  reset({ key: '' });
  assert.deepEqual(await transcribeAudio(audio, 'audio/ogg'), { text: null, reason: 'not_configured' });
  assert.equal(requests.length, 0);
});

test('silence, empty and oversized audio come back as reasons, not text', async () => {
  reset();
  respond = async () => ({ text: '[no speech]' });
  assert.deepEqual(await transcribeAudio(audio, 'audio/ogg'), { text: null, reason: 'no_speech' });
  assert.deepEqual(await transcribeAudio(Buffer.alloc(0), 'audio/ogg'), { text: null, reason: 'empty' });
  assert.deepEqual(await transcribeAudio(Buffer.alloc(TRANSCRIPTION_MAX_BYTES + 1), 'audio/ogg'), { text: null, reason: 'too_large' });
});

test('a busy main model falls back to the lite model', async () => {
  reset();
  respond = async (req) => {
    if (req.model === 'main-model') throw new Error('503 UNAVAILABLE');
    return { text: 'from the fallback' };
  };
  assert.deepEqual(await transcribeAudio(audio, 'audio/ogg'), { text: 'from the fallback' });
  assert.deepEqual(requests.map((r) => r.model), ['main-model', 'lite-model']);
});

test('both models failing is reported as failed, never thrown', async () => {
  reset();
  respond = async () => { throw new Error('400 INVALID_ARGUMENT'); };
  assert.deepEqual(await transcribeAudio(audio, 'audio/ogg'), { text: null, reason: 'failed' });
});
