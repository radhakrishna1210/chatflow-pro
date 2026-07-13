import * as service from '../services/support.service.js';

export async function create(req, res) {
  const ticket = await service.createTicket(req.params.workspaceId, req.user.id, req.body || {});
  res.status(201).json(ticket);
}
export async function list(req, res) {
  res.json(await service.listWorkspaceTickets(req.params.workspaceId));
}
