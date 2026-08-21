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
import { carouselCards, buildCardBodyComponent, buildCardButtonComponents } from '../lib/templateParams.js';
import { uploadPhoneMedia } from '../lib/meta.js';

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

// Providers are tried in order, falling through when one is billing-blocked or
// unreachable — because both paid providers can be dead at the same time.
// OpenAI bills every image with no free allowance, and Gemini's image models
// are not on its free tier at all (it reports "limit: 0"). Cloudflare Workers
// AI sits last precisely because it is the leg that still works when there is
// no credit anywhere, so the feature degrades instead of disappearing.
const PROVIDER_ORDER = ['openai', 'cloudflare', 'gemini'];

const providerConfigured = {
  openai: () => Boolean(env.OPENAI_API_KEY),
  cloudflare: () => Boolean(env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_API_TOKEN),
  gemini: () => Boolean(env.GEMINI_API_KEY),
};

function providerChain() {
  if (env.IMAGE_PROVIDER !== 'auto') {
    return providerConfigured[env.IMAGE_PROVIDER]?.() ? [env.IMAGE_PROVIDER] : [];
  }
  return PROVIDER_ORDER.filter((name) => providerConfigured[name]());
}

// 402 means "this provider wants money", 503 "not configured", 502 "gave us
// nothing usable" — all worth trying the next provider for. A 422 is a content
// refusal, which is a decision to respect rather than shop around for.
const shouldFallThrough = (err) => [402, 502, 503].includes(err?.status);

// Cloudflare's models don't declare their output format, so it is read from the
// bytes. This doubles as proof that what came back is an image at all.
function sniffImageType(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') return 'image/png';
  return null;
}

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
  if (status === 429 || /quota|billing|insufficient|credit/i.test(raw)) {
    const e = new Error(
      /quota|billing|insufficient|credit/i.test(raw)
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

// The error body arrives as a Buffer because the request asked for binary.
function bodyText(body) {
  if (!body) return '';
  try {
    return Buffer.isBuffer(body) ? body.toString('utf8') : typeof body === 'string' ? body : JSON.stringify(body);
  } catch { return ''; }
}

// Workers AI answers with a JSON error body even when the request asked for
// binary, so the buffer is decoded before being read.
function describeCloudflareImageError(err) {
  const status = err?.response?.status;
  let raw = String(err?.message || '');
  const body = err?.response?.data;
  if (body) {
    try {
      const text = Buffer.isBuffer(body) ? body.toString('utf8') : typeof body === 'string' ? body : JSON.stringify(body);
      const parsed = JSON.parse(text);
      raw = parsed?.errors?.[0]?.message || parsed?.error || raw;
    } catch { /* not JSON — keep the axios message */ }
  }

  if (status === 401 || status === 403) {
    const e = new Error('Cloudflare rejected the API token. It needs the "Workers AI: Read" permission — check CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID.');
    e.status = 502;
    return e;
  }
  if (status === 429 || /limit|exceeded/i.test(raw)) {
    const e = new Error('The Cloudflare Workers AI free daily allowance is used up. It resets each day, or you can upload a header image yourself.');
    e.status = 402;
    return e;
  }
  if (status === 404) {
    const e = new Error(`Cloudflare does not have the model "${env.CLOUDFLARE_IMAGE_MODEL}". Set CLOUDFLARE_IMAGE_MODEL to one from the Workers AI catalogue.`);
    e.status = 502;
    return e;
  }
  const e = new Error(`Cloudflare could not generate the image${raw ? ` (${raw})` : ''}. Try again, or upload a header image yourself.`);
  e.status = 502;
  return e;
}

// The free leg of the chain. Workers AI returns one of two shapes depending on
// the model — flux-1-schnell puts base64 inside JSON, the SDXL models stream
// raw image bytes — so the response is taken as an ArrayBuffer and worked out
// afterwards. That way changing CLOUDFLARE_IMAGE_MODEL needs no code change.
async function generateWithCloudflare(prompt, { withDimensions = true } = {}) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/run/${env.CLOUDFLARE_IMAGE_MODEL}`;
  let res;
  try {
    res = await axios.post(
      url,
      // Without width/height these models default to a 1024x1024 square, which
      // WhatsApp then crops to its wide header card — losing the top and bottom
      // of the subject. 1280x768 matches the card's shape. steps is capped at 8
      // for flux-1-schnell and ignored by models that don't take it; 4 is the
      // quality/latency sweet spot for an image this small.
      withDimensions ? { prompt, steps: 4, width: 1280, height: 768 } : { prompt, steps: 4 },
      {
        headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json' },
        responseType: 'arraybuffer',
        timeout: 120000,
      },
    );
  } catch (err) {
    // Workers AI has intermittently rejected width/height as "additional
    // properties not allowed" for a model that accepts them seconds later —
    // a schema-validation wobble on their side. A square header that gets
    // cropped beats no header at all, so retry once without them.
    const raw = bodyText(err?.response?.data);
    if (withDimensions && /width|height|Bad input|not allowed/i.test(raw)) {
      console.warn('[TemplateImage] Cloudflare rejected width/height — retrying at the default size');
      return generateWithCloudflare(prompt, { withDimensions: false });
    }
    console.error('[TemplateImage] Cloudflare generation failed:', err?.message);
    throw describeCloudflareImageError(err);
  }

  let buffer = Buffer.from(res.data);
  const isJson = String(res.headers?.['content-type'] || '').includes('json');
  if (isJson) {
    let parsed;
    try { parsed = JSON.parse(buffer.toString('utf8')); } catch {
      const e = new Error('Cloudflare returned a response that could not be read as an image.');
      e.status = 502;
      throw e;
    }
    // A failure can arrive as HTTP 200 with success:false.
    if (parsed?.success === false) throw describeCloudflareImageError({ response: { status: 200, data: buffer } });
    const b64 = parsed?.result?.image;
    if (!b64) {
      const e = new Error('Cloudflare did not return an image. Try again.');
      e.status = 502;
      throw e;
    }
    buffer = Buffer.from(b64, 'base64');
  }

  const mimeType = sniffImageType(buffer);
  if (!mimeType) {
    const e = new Error('Cloudflare returned data that is not a JPEG or PNG image.');
    e.status = 502;
    throw e;
  }
  return { buffer, mimeType };
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
  const chain = providerChain();
  if (chain.length === 0) {
    const e = new Error(
      env.IMAGE_PROVIDER === 'auto'
        ? 'Image generation is not configured. Set OPENAI_API_KEY, or CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN for the free tier. You can upload a header image instead.'
        : `IMAGE_PROVIDER is pinned to "${env.IMAGE_PROVIDER}", but that provider has no credentials configured.`,
    );
    e.status = 503;
    e.expose = true;
    throw e;
  }

  const prompt = buildImagePrompt({ imageIdea, body, category });
  const generators = { openai: generateWithOpenAi, cloudflare: generateWithCloudflare, gemini: generateWithGemini };

  const failures = [];
  for (const provider of chain) {
    try {
      const { buffer, mimeType } = await generators[provider](prompt);

      // Validated per provider rather than once at the end, so a provider that
      // returns something unsendable falls through to the next one instead of
      // failing the whole request.
      if (!SENDABLE_IMAGE_TYPES.has(mimeType)) {
        const e = new Error(`${provider} returned an unsupported image type (${mimeType}). WhatsApp headers must be JPEG or PNG.`);
        e.status = 502;
        throw e;
      }
      if (buffer.length > MAX_IMAGE_BYTES) {
        const e = new Error(`The generated image is ${(buffer.length / 1024 / 1024).toFixed(1)} MB — WhatsApp headers must be 5 MB or smaller.`);
        e.status = 502;
        throw e;
      }

      if (provider !== chain[0]) console.warn(`[TemplateImage] generated with ${provider} after ${chain[0]} was unavailable`);
      return { buffer, mimeType, prompt, provider };
    } catch (err) {
      if (!shouldFallThrough(err)) throw err;
      failures.push({ provider, err });
      console.warn(`[TemplateImage] ${provider} unavailable (${err.status}): ${err.message}`);
    }
  }

  // Every provider failed. Reporting only the last one is actively misleading:
  // the chain ends on Gemini, so a Cloudflare token typo would surface as
  // "Gemini has no quota". Each reason is listed instead, in the order tried.
  const e = new Error(
    failures.length === 1
      ? failures[0].err.message
      : `No image provider could generate this. ${failures.map((f) => `${f.provider}: ${f.err.message}`).join(' ')}`,
  );
  e.status = failures[0].err.status;
  throw e;
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

// Builds the `carousel` component a carousel template needs on every send.
//
// Each card repeats the header/body/button work the message bubble does, and
// the card's picture has the same problem the main header has — the
// `header_handle` Meta reviewed cannot be sent, so the stored bytes are
// re-minted into a phone-scoped media id here. The asset id rides along on the
// stored card header as `_assetId` (see lib/templateStructure.js) because a
// carousel has up to ten pictures and Template.headerAssetId holds only one.
export async function carouselComponent(template, { phoneNumberId, accessToken, resolve }) {
  const cards = carouselCards(template?.components);
  if (cards.length === 0) return null;

  const built = [];
  for (const [index, card] of cards.entries()) {
    const header = (Array.isArray(card?.components) ? card.components : [])
      .find((c) => String(c?.type || '').toUpperCase() === 'HEADER');
    const assetId = header?._assetId;
    if (!assetId) {
      const e = new Error(`Card ${index + 1} of template "${template.name}" has no stored media to send. Re-upload the card's image.`);
      e.status = 422;
      throw e;
    }
    const asset = await prisma.templateAsset.findUnique({ where: { id: assetId } });
    if (!asset) {
      const e = new Error(`The media for card ${index + 1} of template "${template.name}" is missing. Re-upload it.`);
      e.status = 422;
      throw e;
    }

    const mediaId = await resolveSendableMediaId(asset, { phoneNumberId, accessToken });
    const kind = String(header.format || 'IMAGE').toLowerCase();
    const components = [{ type: 'header', parameters: [{ type: kind, [kind]: { id: mediaId } }] }];

    const body = buildCardBodyComponent(card, resolve);
    if (body) components.push(body);
    components.push(...buildCardButtonComponents(card));

    built.push({ card_index: index, components });
  }

  return { type: 'carousel', cards: built };
}
