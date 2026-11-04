import * as quotesService from '../services/quotes.service.js';

export async function list(req, res) {
  res.json(await quotesService.listQuotes(req.params.workspaceId, { status: req.query.status, dealId: req.query.dealId }, req.user));
}
export async function get(req, res) {
  res.json(await quotesService.getQuote(req.params.workspaceId, req.params.id, req.user));
}
export async function create(req, res) {
  res.status(201).json(await quotesService.createQuote(req.params.workspaceId, req.body, req.user.id, req.user));
}
export async function update(req, res) {
  res.json(await quotesService.updateQuote(req.params.workspaceId, req.params.id, req.body, req.user));
}
export async function changeStatus(req, res) {
  res.json(await quotesService.changeQuoteStatus(req.params.workspaceId, req.params.id, req.body.status, req.user));
}
export async function remove(req, res) {
  await quotesService.deleteQuote(req.params.workspaceId, req.params.id, req.user);
  res.status(204).send();
}
export async function addLine(req, res) {
  res.status(201).json(await quotesService.addQuoteLineItem(req.params.workspaceId, req.params.id, req.body, req.user));
}
export async function removeLine(req, res) {
  res.json(await quotesService.deleteQuoteLineItem(req.params.workspaceId, req.params.id, req.params.lineId, req.user));
}
