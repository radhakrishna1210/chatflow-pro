import * as conversationsService from '../services/conversations.service.js';

export async function list(req, res) {
  const { page, limit } = req.query;
  const result = await conversationsService.listConversations(req.params.workspaceId, { page: +page || 1, limit: +limit || 20 });
  res.json(result);
}

export async function getMessages(req, res) {
  const messages = await conversationsService.getMessages(req.params.workspaceId, req.params.id);
  res.json(messages);
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
