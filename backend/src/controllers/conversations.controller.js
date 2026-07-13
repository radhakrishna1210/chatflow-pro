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

export async function sendMessage(req, res) {
  const message = await conversationsService.sendMessage(
    req.params.workspaceId,
    req.params.id,
    req.user.id,
    req.body
  );
  res.status(201).json(message);
}
