// Generates and stores the picture used as a template's media header.
//
// Three separate things have to line up for an image to reach a customer, and
// they use three different Meta identifiers — that's why this file exists
// rather than the bytes just being passed around:
//
//   1. Preview    — a data URI, shown in the draft modal before anything saves.
//   2. Approval   — a `header_handle` from the Resumable Upload API, which Meta
//                   accepts ONLY when the template is created, as a review
//                   sample. It cannot be sent.
//   3. Sending    — a media id from POST /{phone-number-id}/media, supplied
//                   again on every single send, expiring after ~30 days.
//
// The bytes are kept in TemplateAsset because (2) and (3) are not
// interchangeable and (3) has to be re-mintable long after approval.

import axios from 'axios';
import { GoogleGenAI } from '@google/genai';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { uploadPhoneMedia } from '../lib/meta.js';

let _ai = null;
function getAi() {
  if (!env.GEMINI_API_KEY) return null;
  if (!_ai) _ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  return _ai;
}

// OpenAI is preferred when configured: Gemini's image models are not offered
// on its free tier at all, so a key that generates copy perfectly well still
// reports "limit: 0" for pictures. Gemini stays as the fallback rather than
// being replaced, so this is reversible by unsetting one variable.
const imageProvider = () => (env.OPENAI_API_KEY ? 'openai' : env.GEMINI_API_KEY ? 'gemini' : null);

// WhatsApp caps header images at 5 MB and renders them in a small, wide card,
// so a photographic 4:3 is both cheaper and closer to what the customer sees
// than the square default.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// A media id is valid for ~30 days. Re-minting at 25 leaves room for a long
// campaign that started before the window closed.
const MEDIA_ID_MAX_AGE_MS = 25 * 24 * 60 * 60 * 1000;

// Meta only accepts JPEG and PNG in an image header.
const SENDABLE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png']);

// Turns the draft's one-line "image idea" into an actual image brief. Models
// left to themselves put text in the picture, and WhatsApp header images are
// small enough that rendered words are unreadable — worse, Meta rejects
// templates whose header duplicates the message copy.
function buildImagePrompt({ imageIdea, body, category }) {
  const subject = String(imageIdea || '').trim() || String(body || '').trim().slice(0, 200);
  return [
    `Create a photographic marketing image for a WhatsApp message header: ${subject}`,
    '',
    'Requirements:',
    '- Landscape 4:3 composition, the subject centred and clearly readable at a small size.',
    '- Warm, well-lit, realistic product/lifestyle photography. No illustration or 3D render look.',
    '- Absolutely no text, no words, no letters, no numbers, no logos and no watermarks anywhere in the image.',
    '- Nothing resembling a user interface, a phone screen or a chat bubble.',
    '- Leave the edges uncluttered so the image survives being cropped to a wide card.',
    category === 'MARKETING'
      ? '- Appealing and promotional in feel, but honest: do not depict discounts, prices or claims.'
      : '- Calm and informative in feel, suited to a transactional notification.',
  ].join('\n');
}

// Maps Gemini's failure modes to something a user can act on. The image models
// are not part of the Gemini free tier — a free key does not get a small quota
// for them, it gets zero — and the raw error for that is a generic 429 that
// reads like a temporary rate limit.
function describeGeminiImageError(err) {
  const status = err?.status ?? err?.code;
  const raw = String(err?.message || '');

  if (status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(raw)) {
    const e = new Error(
      'Gemini image generation is not available on this API key. It is a paid-tier feature — enable billing on the Google AI Studio key (the free tier allows zero image requests). You can still upload a header image yourself.',
    );
    e.status = 402;
    return e;
  }
  if (status === 404 || /not found|not supported/i.test(raw)) {
    const e = new Error(`The configured image model "${env.GEMINI_IMAGE_MODEL}" is not available to this key. Set GEMINI_IMAGE_MODEL to one the key can use.`);
    e.status = 502;
    return e;
  }
  if (/safety|blocked|PROHIBITED/i.test(raw)) {
    const e = new Error('Gemini declined to generate that image. Try describing the picture differently.');
    e.status = 422;
    return e;
  }
  const e = new Error('The image could not be generated right now. Try again, or upload a header image yourself.');
  e.status = 502;
  return e;
}

// OpenAI reports its two most likely blockers — an unverified organisation and
// an empty credit balance — as a bare 403/429, so they need spelling out or
// they read as "the feature is broken".
function describeOpenAiImageError(err) {
  const status = err?.response?.status;
  const api = err?.response?.data?.error || {};
  const raw = String(api.message || err?.message || '');

  if (status === 401) {
    const e = new Error('OpenAI rejected the API key. Check OPENAI_API_KEY on the server.');
    e.status = 502;
    return e;
  }
  if (status === 403 || /verif/i.test(raw)) {
    const e = new Error(
      `OpenAI will not run "${env.OPENAI_IMAGE_MODEL}" for this organisation. gpt-image-1 requires organisation verification (platform.openai.com → Settings → Organization → General). Verify the org, or set OPENAI_IMAGE_MODEL=dall-e-3, which needs no verification.`,
    );
    e.status = 402;
    return e;
  }
  if (status === 429 || /quota|billing|insufficient/i.test(raw)) {
    const e = new Error(
      /quota|billing|insufficient/i.test(raw)
        ? 'The OpenAI account has no credit left for image generation. Add credit at platform.openai.com → Billing. You can still upload a header image yourself.'
        : 'OpenAI is rate limiting image requests right now. Wait a moment and try again.',
    );
    e.status = 402;
    return e;
  }
  if (/safety|moderation|rejected|content policy/i.test(raw)) {
    const e = new Error('OpenAI declined to generate that image under its content policy. Try describing the picture differently.');
    e.status = 422;
    return e;
  }
  if (status === 404) {
    const e = new Error(`The configured image model "${env.OPENAI_IMAGE_MODEL}" is not available to this key. Set OPENAI_IMAGE_MODEL to one the account can use.`);
    e.status = 502;
    return e;
  }
  const e = new Error('The image could not be generated right now. Try again, or upload a header image yourself.');
  e.status = 502;
  return e;
}

// The two models take different parameter names for the same ideas, and each
// rejects the other's — gpt-image-1 400s on `response_format`, dall-e-3 400s on
// `output_format` and on a 'medium' quality.
function openAiImageRequest(prompt) {
  const model = env.OPENAI_IMAGE_MODEL;
  if (model.startsWith('dall-e')) {
    const quality = ['standard', 'hd'].includes(env.OPENAI_IMAGE_QUALITY) ? env.OPENAI_IMAGE_QUALITY : 'standard';
    // dall-e-3's landscape is 16:9; it has no 3:2.
    return { model, prompt, n: 1, size: '1792x1024', quality, response_format: 'b64_json' };
  }
  const quality = ['low', 'medium', 'high', 'auto'].includes(env.OPENAI_IMAGE_QUALITY) ? env.OPENAI_IMAGE_QUALITY : 'medium';
  // gpt-image-1 always returns base64; asking for a format it doesn't take is
  // an error, not an ignored field. JPEG keeps a 1536x1024 render well under
  // WhatsApp's 5 MB header cap.
  return { model, prompt, n: 1, size: '1536x1024', quality, output_format: 'jpeg' };
}

async function generateWithOpenAi(prompt) {
  let data;
  try {
    ({ data } = await axios.post(
      'https://api.openai.com/v1/images/generations',
      openAiImageRequest(prompt),
      {
        headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        // A high-quality render regularly runs past a minute; the default of no
        // timeout is worse, but 30s would cut off successful generations.
        timeout: 120000,
      },
    ));
  } catch (err) {
    console.error('[TemplateImage] OpenAI generation failed:', err?.response?.data?.error?.message || err.message);
    throw describeOpenAiImageError(err);
  }

  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) {
    const e = new Error('OpenAI did not return an image. Try again.');
    e.status = 502;
    throw e;
  }
  // Both request shapes above ask for JPEG explicitly (dall-e-3 only ever
  // returns PNG, which is equally sendable).
  const mimeType = env.OPENAI_IMAGE_MODEL.startsWith('dall-e') ? 'image/png' : 'image/jpeg';
  return { buffer: Buffer.from(b64, 'base64'), mimeType };
}

async function generateWithGemini(prompt) {
  const ai = getAi();
  let response;
  try {
    response = await ai.models.generateContent({
      model: env.GEMINI_IMAGE_MODEL,
      contents: prompt,
      config: { responseModalities: ['IMAGE'] },
    });
  } catch (err) {
    console.error('[TemplateImage] Gemini generation failed:', err.message);
    throw describeGeminiImageError(err);
  }

  const parts = response?.candidates?.[0]?.content?.parts || [];
  const image = parts.find((p) => p?.inlineData?.data);
  if (!image) {
    // A safety block comes back as a well-formed response with no image part
    // rather than as a thrown error.
    const reason = response?.candidates?.[0]?.finishReason;
    const e = new Error(
      reason && reason !== 'STOP'
        ? `Gemini did not return an image (${reason}). Try describing the picture differently.`
        : 'Gemini did not return an image. Try again.',
    );
    e.status = 502;
    throw e;
  }

  return { buffer: Buffer.from(image.inlineData.data, 'base64'), mimeType: image.inlineData.mimeType || 'image/png' };
}

// Generates the image and returns raw bytes. Does not persist — the caller
// decides whether a draft the user may discard is worth a row.
export async function generateHeaderImage({ imageIdea, body, category }) {
  const provider = imageProvider();
  if (!provider) {
    const e = new Error('Image generation needs OPENAI_API_KEY (or GEMINI_API_KEY) on the server. Upload a header image instead.');
    e.status = 503;
    throw e;
  }

  const prompt = buildImagePrompt({ imageIdea, body, category });
  const { buffer, mimeType } =
    provider === 'openai' ? await generateWithOpenAi(prompt) : await generateWithGemini(prompt);

  if (!SENDABLE_IMAGE_TYPES.has(mimeType)) {
    const e = new Error(`The generated image is an unsupported type (${mimeType}). WhatsApp headers must be JPEG or PNG.`);
    e.status = 502;
    throw e;
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    const e = new Error(`The generated image is ${(buffer.length / 1024 / 1024).toFixed(1)} MB — WhatsApp headers must be 5 MB or smaller.`);
    e.status = 502;
    throw e;
  }

  return { buffer, mimeType, prompt, provider };
}

// Persists bytes so they can be re-sent long after the template is approved.
export async function storeAsset(workspaceId, { buffer, mimeType, prompt = null, source = 'upload' }) {
  return prisma.templateAsset.create({
    data: { workspaceId, mimeType, bytes: buffer, sizeBytes: buffer.length, prompt, source },
    select: { id: true, mimeType: true, sizeBytes: true, source: true, createdAt: true },
  });
}

export async function getAsset(workspaceId, assetId) {
  const asset = await prisma.templateAsset.findFirst({ where: { id: assetId, workspaceId } });
  if (!asset) { const e = new Error('That image is no longer available'); e.status = 404; throw e; }
  return asset;
}

export const toDataUri = (mimeType, buffer) => `data:${mimeType};base64,${Buffer.from(buffer).toString('base64')}`;

// The `header` entry a send must carry when the template has an image header,
// or null when it doesn't. Meta requires this on EVERY send of such a template
// — omitting it fails the message with error 132000 (parameter count mismatch),
// which is what made image headers look like they simply didn't arrive.
export async function headerImageComponent(template, { phoneNumberId, accessToken }) {
  const header = (Array.isArray(template?.components) ? template.components : [])
    .find((c) => String(c?.type || '').toUpperCase() === 'HEADER');
  if (!header || String(header.format || '').toUpperCase() !== 'IMAGE') return null;

  if (!template.headerAssetId) {
    // An image-header template synced from Meta, or created before assets
    // existed, has no bytes on our side to re-send.
    const e = new Error(`Template "${template.name}" has an image header but no stored image to send. Re-upload its header image.`);
    e.status = 422;
    throw e;
  }

  const asset = await prisma.templateAsset.findUnique({ where: { id: template.headerAssetId } });
  if (!asset) {
    const e = new Error(`The header image for template "${template.name}" is missing. Re-upload it.`);
    e.status = 422;
    throw e;
  }

  const mediaId = await resolveSendableMediaId(asset, { phoneNumberId, accessToken });
  return { type: 'header', parameters: [{ type: 'image', image: { id: mediaId } }] };
}

// Returns a media id valid for sending from `phoneNumberId`, uploading the
// stored bytes only when the cached id is missing, stale, or was minted for a
// different number.
export async function resolveSendableMediaId(asset, { phoneNumberId, accessToken }) {
  const fresh =
    asset.metaMediaId &&
    asset.metaMediaNumberId === phoneNumberId &&
    asset.metaMediaAt &&
    Date.now() - new Date(asset.metaMediaAt).getTime() < MEDIA_ID_MAX_AGE_MS;
  if (fresh) return asset.metaMediaId;

  const mediaId = await uploadPhoneMedia({
    phoneNumberId,
    accessToken,
    buffer: Buffer.from(asset.bytes),
    mimeType: asset.mimeType,
    fileName: `header_${asset.id}`,
  });

  await prisma.templateAsset.update({
    where: { id: asset.id },
    data: { metaMediaId: mediaId, metaMediaNumberId: phoneNumberId, metaMediaAt: new Date() },
  });
  return mediaId;
}
