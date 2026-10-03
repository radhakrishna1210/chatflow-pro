import * as conversationsService from '../services/conversations.service.js';
import { getMessageMedia } from '../services/inboundMedia.service.js';

export async function list(req, res) {
  const { page, limit, contactId, search, cursor, view } = req.query;
  const result = await conversationsService.listConversations(req.params.workspaceId, {
    page: +page || 1,
    limit: +limit || 20,
    contactId: contactId ? String(contactId).trim() : null,
    search: search ? String(search).trim() : '',
    cursor: cursor ? String(cursor) : null,
    view: view ? String(view) : null,
    userId: req.user?.id ?? null,
  });
  res.json(result);
}

export async function createOrGet(req, res) {
  const { contactId, waNumberId } = req.body || {};
  if (!contactId) {
    return res.status(400).json({ error: 'contactId is required' });
  }
  const conversation = await conversationsService.getOrCreateConversation(req.params.workspaceId, {
    contactId: String(contactId).trim(),
    waNumberId: waNumberId ? String(waNumberId).trim() : null,
  });
  res.status(200).json(conversation);
}

export async function getMessages(req, res) {
  const messages = await conversationsService.getMessages(req.params.workspaceId, req.params.id);
  res.json(messages);
}

// The bytes of a message's photo, voice note, video or document, from file
// storage (or re-fetched from Meta when it was never archived). Streamed
// through the API rather than linked: every route needs the bearer token, and
// it keeps one code path for the disk and bucket drivers.
export async function media(req, res) {
  const file = await getMessageMedia(req.params.workspaceId, req.params.id, req.params.messageId);
  const ascii = String(file.filename).replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  res.set('Content-Type', file.contentType);
  // Customer-supplied files: only known media types render inline, and even
  // those cannot run script on this origin.
  res.set('Content-Disposition', `${file.inline ? 'inline' : 'attachment'}; filename="${ascii}"`);
  res.set('Content-Security-Policy', "default-src 'none'; sandbox");
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Cache-Control', 'private, max-age=3600');
  if (file.size) res.set('Content-Length', String(file.size));
  if (file.buffer) { res.end(file.buffer); return; }
  file.stream.on('error', (err) => {
    console.error('[Conversations] media stream failed:', err.message);
    res.destroy(err);
  });
  file.stream.pipe(res);
}

// An attachment on an open conversation. The file arrives as multipart, so the
// body carries only the optional caption.
export async function sendMedia(req, res) {
  const message = await conversationsService.sendMediaMessage(
    req.params.workspaceId, req.params.id, req.user.id,
    {
      buffer: req.file?.buffer,
      mimeType: String(req.file?.mimetype || '').split(';')[0].trim(),
      fileName: req.file?.originalname,
      caption: req.body?.caption,
    },
  );
  res.status(201).json(message);
}

// The only thing WhatsApp permits once the 24-hour window has closed. Every
// error message told the agent to send a template; this is the route that lets
// them actually do it.
export async function sendTemplate(req, res) {
  const message = await conversationsService.sendTemplateMessage(
    req.params.workspaceId, req.params.id, req.user.id, req.body || {},
  );
  res.status(201).json(message);
}

export async function sendMessage(req, res) {
  const message = await conversationsService.sendMessage(
    req.params.workspaceId,
    req.params.id,
    req.user.id,
    req.body
  );
  res.status(201).json(message);
}

// Campaign source, AI session and customer timeline for the inbox side panel.
export async function context(req, res) {
  try {
    res.json(await conversationsService.getContext(req.params.workspaceId, req.params.id));
  } catch (err) {
    console.error('[Conversations] context error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Failed to load conversation context' });
  }
}

// A drafted reply for the composer's suggestion chips.
export async function suggest(req, res) {
  try {
    res.json(await conversationsService.suggestReply(req.params.workspaceId, req.params.id));
  } catch (err) {
    console.error('[Conversations] suggest error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Failed to draft a reply' });
  }
}

// Hand the thread back to the automation, or keep it away.
export async function setBot(req, res) {
  res.json(await conversationsService.setBotEnabled(
    req.params.workspaceId, req.params.id, req.body?.enabled !== false,
  ));
}

// ── Internal notes, assignment and status ──
const handle = (res, fn, fallback) => fn().then((data) => res.json(data)).catch((err) => {
  if (!err?.status || err.status >= 500) console.error('[Conversations]', err);
  res.status(err?.status || 500).json({ error: err?.message || fallback });
});

export function listNotes(req, res) {
  return handle(res, () => conversationsService.listNotes(req.params.workspaceId, req.params.id), 'Failed to load notes');
}

export function addNote(req, res) {
  return handle(res, () => conversationsService.addNote(req.params.workspaceId, req.params.id, req.user?.id, req.body?.body), 'Failed to save the note');
}

export function deleteNote(req, res) {
  return handle(res, () => conversationsService.deleteNote(req.params.workspaceId, req.params.id, req.params.noteId), 'Failed to delete the note');
}

export function assign(req, res) {
  return handle(res, () => conversationsService.assignConversation(req.params.workspaceId, req.params.id, req.body?.assignedToUserId), 'Failed to assign the conversation');
}

export function setStatus(req, res) {
  return handle(res, () => conversationsService.setConversationStatus(req.params.workspaceId, req.params.id, req.body?.status), 'Failed to update the conversation');
}
