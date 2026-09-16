import * as ticketsService from '../services/tickets.service.js';

export async function list(req, res) {
  const { view, status, priority } = req.query;
  res.json(await ticketsService.listTickets(req.params.workspaceId, { view, status, priority }, req.user));
}
export async function counts(req, res) {
  res.json(await ticketsService.ticketCounts(req.params.workspaceId, req.user));
}
export async function get(req, res) {
  res.json(await ticketsService.getTicket(req.params.workspaceId, req.params.id, req.user));
}
export async function create(req, res) {
  res.status(201).json(await ticketsService.createTicket(req.params.workspaceId, req.body));
}
export async function update(req, res) {
  res.json(await ticketsService.updateTicket(req.params.workspaceId, req.params.id, req.body, req.user));
}
export async function changeStatus(req, res) {
  res.json(await ticketsService.changeTicketStatus(req.params.workspaceId, req.params.id, req.body.status, req.user));
}
export async function remove(req, res) {
  await ticketsService.deleteTicket(req.params.workspaceId, req.params.id, req.user);
  res.status(204).send();
}
