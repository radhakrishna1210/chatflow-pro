import { GoogleGenAI } from '@google/genai';
import { env } from '../config/env.js';
import { downloadMediaBuffer } from '../lib/meta.js';

let _ai = null;
let _aiKey = null;

function getAi() {
  const key = env.GEMINI_API_KEY;
  if (!key) return null;
  if (!_ai || _aiKey !== key) {
    _ai = new GoogleGenAI({ apiKey: key });
    _aiKey = key;
  }
  return _ai;
}

const CLEAN_MIME_TYPES = {
  'audio/ogg; codecs=opus': 'audio/ogg',
  'audio/ogg': 'audio/ogg',
  'audio/opus': 'audio/ogg',
  'audio/mpeg': 'audio/mp3',
  'audio/mp3': 'audio/mp3',
  'audio/mp4': 'audio/mp4',
  'audio/m4a': 'audio/mp4',
  'audio/x-m4a': 'audio/mp4',
  'audio/wav': 'audio/wav',
  'audio/x-wav': 'audio/wav',
  'audio/wave': 'audio/wav',
  'audio/aac': 'audio/aac',
  'audio/flac': 'audio/flac',
  'audio/x-flac': 'audio/flac',
  'audio/amr': 'audio/amr',
  'audio/3gpp': 'audio/3gpp',
};

export function cleanAudioMime(mime) {
  const base = String(mime || '').toLowerCase().trim();
  if (CLEAN_MIME_TYPES[base]) return CLEAN_MIME_TYPES[base];
  const stripped = base.split(';')[0].trim();
  return CLEAN_MIME_TYPES[stripped] || stripped || 'audio/ogg';
}

/**
 * Transcribe and translate an audio buffer into text.
 * Uses Gemini multimodal audio understanding with model failover,
 * and falls back to OpenAI Whisper if available.
 *
 * @param {Buffer} buffer - Raw audio file bytes
 * @param {string} [mimeType='audio/ogg'] - Incoming MIME type
 * @returns {Promise<string|null>} - Transcribed/translated text, or null
 */
export async function transcribeAudioBuffer(buffer, mimeType = 'audio/ogg') {
  if (!buffer || buffer.length === 0) return null;

  const ai = getAi();
  const cleanMime = cleanAudioMime(mimeType);

  // Model chain: start with reliable capacity lite model, then flash models
  const models = [
    'gemini-flash-lite-latest',
    'gemini-1.5-flash',
    env.GEMINI_FALLBACK_MODEL,
    env.GEMINI_MODEL,
  ].filter(Boolean);

  const prompt = `You are an expert speech recognition and translation assistant.
Listen to this audio voice note carefully.
1. Transcribe the spoken speech into text accurately.
2. If the user spoke in any language other than English (e.g. Hindi, Spanish, French, German, Arabic, Bengali, Marathi, etc.) or a mix of languages (e.g. Hinglish), transcribe and translate the core intent to clear English so that automated customer support agents, workflows, and intent matchers can properly understand and reply.
3. Return ONLY the transcribed text. Do NOT include quotes, timestamps, commentary, or conversational preamble. If the audio is completely silent or contains no intelligible words, reply with EMPTY.`;

  if (ai) {
    const base64Data = buffer.toString('base64');
    for (const model of [...new Set(models)]) {
      try {
        const res = await ai.models.generateContent({
          model,
          contents: [
            {
              inlineData: {
                mimeType: cleanMime,
                data: base64Data,
              },
            },
            { text: prompt },
          ],
        });

        const text = (res.text || '').trim();
        if (!text || /^EMPTY$/i.test(text)) {
          // Empty or silent audio
          continue;
        }

        // Clean any accidental markdown quotes or formatting
        const cleaned = text.replace(/^["']|["']$/g, '').trim();
        if (cleaned.length > 0 && !/^EMPTY$/i.test(cleaned)) {
          return cleaned;
        }
      } catch (err) {
        console.warn(`[STT] Model ${model} failed for ${cleanMime}: ${err.message?.slice(0, 100)}`);
      }
    }
  }

  // Fallback: OpenAI Whisper if OPENAI_API_KEY is configured
  if (env.OPENAI_API_KEY) {
    try {
      const formData = new FormData();
      formData.append('file', new Blob([buffer], { type: cleanMime }), 'voice_note.ogg');
      formData.append('model', 'whisper-1');

      const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
        body: formData,
      });

      if (res.ok) {
        const data = await res.json();
        const whisperText = (data.text || '').trim();
        if (whisperText) return whisperText;
      }
    } catch (err) {
      console.warn('[STT] OpenAI Whisper fallback failed:', err.message);
    }
  }

  return null;
}

/**
 * Downloads a WhatsApp media attachment by ID and transcribes it to text.
 *
 * @param {Object} opts
 * @param {string} opts.mediaId - Meta media ID
 * @param {string} [opts.accessToken] - WaNumber or system access token
 * @param {string} [opts.mimeType] - Expected media MIME type
 * @returns {Promise<{ text: string|null, buffer: Buffer, mimeType: string }|null>}
 */
export async function transcribeWhatsAppAudio({ mediaId, accessToken, mimeType = 'audio/ogg' }) {
  if (!mediaId) return null;

  try {
    const downloaded = await downloadMediaBuffer(mediaId, accessToken);
    const resolvedMime = downloaded.mimeType || mimeType;
    const text = await transcribeAudioBuffer(downloaded.buffer, resolvedMime);

    return {
      text: text || null,
      buffer: downloaded.buffer,
      mimeType: resolvedMime,
      fileSize: downloaded.fileSize,
    };
  } catch (err) {
    console.error(`[STT] Failed to transcribe WhatsApp audio ${mediaId}:`, err.message);
    return null;
  }
}
