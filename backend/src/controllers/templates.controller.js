import * as templatesService from '../services/templates.service.js';
import { generateTemplateDraft, generateUtilityVariant, TEMPLATE_SUGGESTIONS } from '../services/templateAi.service.js';
import { generateHeaderImage, getAsset, storeAsset, toDataUri } from '../services/templateImage.service.js';

// Uploads a header sample to Meta and hands back the media handle. For an
// image the bytes are also kept (see TemplateAsset) because the handle Meta
// returns is a review sample and cannot be used to send.
export async function uploadMedia(req, res) {
  // Two sources feed this: a file the user just picked, or an image the AI
  // already generated and stored (aiImage below). The generated one is
  // referenced by id rather than posted back as bytes — a base64 data URI of a
  // 5 MB image would blow past the JSON body limit.
  const { workspaceId } = req.params;
  let buffer, mimeType, fileName, source, prompt, existingAssetId = null;

  if (req.file) {
    ({ buffer, mimetype: mimeType, originalname: fileName } = req.file);
    source = 'upload';
    prompt = null;
  } else if (req.body?.assetId) {
    const asset = await getAsset(workspaceId, req.body.assetId);
    buffer = Buffer.from(asset.bytes);
    mimeType = asset.mimeType;
    fileName = `generated-header-${asset.id}`;
    source = asset.source;
    prompt = asset.prompt;
    existingAssetId = asset.id;
  } else {
    res.status(400).json({ error: 'Attach a file to upload' });
    return;
  }

  const result = await templatesService.uploadHeaderMedia(workspaceId, {
    buffer, mimeType, fileName, source, prompt,
    waNumberId: req.body?.waNumberId,
    // Re-uploading an already-stored image to Meta must not duplicate the row.
    existingAssetId,
  });
  res.json(result);
}

// Generates a header image for a draft, stores it, and returns it inline for
// the preview. Deliberately its own endpoint rather than part of aiDraft:
// image generation is billed separately and much slower than the
// copy, so a key without it should still get the template written.
export async function aiImage(req, res) {
  const { imageIdea, body, category } = req.body || {};
  if (!String(imageIdea || body || '').trim()) {
    res.status(400).json({ error: 'Describe the image you want' });
    return;
  }
  const { buffer, mimeType, prompt, provider } = await generateHeaderImage({ imageIdea, body, category });
  const asset = await storeAsset(req.params.workspaceId, { buffer, mimeType, prompt, source: provider });
  res.json({ assetId: asset.id, dataUri: toDataUri(mimeType, buffer), mimeType, sizeBytes: buffer.length, provider });
}

// Serves a stored header image back to the builder so an existing template can
// show the picture it will actually send.
export async function headerImage(req, res) {
  const asset = await getAsset(req.params.workspaceId, req.params.assetId);
  res.set('Content-Type', asset.mimeType);
  res.set('Cache-Control', 'private, max-age=86400');
  res.send(Buffer.from(asset.bytes));
}

export async function aiSuggestions(req, res) {
  res.json({ suggestions: TEMPLATE_SUGGESTIONS });
}

export async function aiDraft(req, res) {
  const draft = await generateTemplateDraft(req.body?.prompt);
  res.json(draft);
}

export async function list(req, res) {
  // Optional ?waNumberId= filters to one number's private templates.
  const templates = await templatesService.listTemplates(req.params.workspaceId, req.query.waNumberId);
  res.json(templates);
}

export async function create(req, res) {
  const template = await templatesService.createTemplate(req.params.workspaceId, req.body);
  res.status(201).json(template);
}

export async function getOne(req, res) {
  const template = await templatesService.getTemplate(req.params.workspaceId, req.params.id);
  res.json(template);
}

export async function update(req, res) {
  const template = await templatesService.updateTemplate(req.params.workspaceId, req.params.id, req.body);
  res.json(template);
}

export async function remove(req, res) {
  await templatesService.deleteTemplate(req.params.workspaceId, req.params.id);
  res.status(204).send();
}

export async function duplicate(req, res) {
  const template = await templatesService.duplicateTemplate(req.params.workspaceId, req.params.id);
  res.status(201).json(template);
}

export async function syncFromMeta(req, res) {
  const result = await templatesService.syncTemplatesFromMeta(req.params.workspaceId, req.body?.waNumberId || req.query?.waNumberId);
  res.json(result);
}

export async function library(req, res) {
  const items = await templatesService.listLibrary(req.params.workspaceId);
  res.json(items);
}

export async function installLibrary(req, res) {
  const tpl = await templatesService.installFromLibrary(req.params.workspaceId, req.params.libId, req.body?.waNumberId);
  res.status(201).json(tpl);
}

// Rewrites an existing template to read as UTILITY, after Meta re-categorised
// it as MARKETING (~7x the per-message price). Returns a draft to review; it
// is never saved over the original.
export async function utilityVariant(req, res) {
  const tpl = await templatesService.getTemplate(req.params.workspaceId, req.params.id);
  const variant = await generateUtilityVariant(tpl);
  res.json(variant);
}
