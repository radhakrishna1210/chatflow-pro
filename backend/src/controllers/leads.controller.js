import * as leadsService from '../services/leads.service.js';

export async function list(req, res) {
  const { status, ownerUserId, search, sort } = req.query;
  const result = await leadsService.listLeads(req.params.workspaceId, { status, ownerUserId, search, sort });
  res.json(result);
}

export async function get(req, res) {
  const result = await leadsService.getLead(req.params.workspaceId, req.params.id);
  res.json(result);
}

export async function create(req, res) {
  const result = await leadsService.createLead(req.params.workspaceId, req.body);
  res.status(201).json(result);
}

export async function update(req, res) {
  const result = await leadsService.updateLead(req.params.workspaceId, req.params.id, req.body);
  res.json(result);
}

export async function remove(req, res) {
  await leadsService.deleteLead(req.params.workspaceId, req.params.id);
  res.status(204).send();
}

export async function recalculateScore(req, res) {
  const result = await leadsService.recalculateScore(req.params.workspaceId, req.params.id);
  res.json(result);
}

export async function convert(req, res) {
  const result = await leadsService.convertLead(req.params.workspaceId, req.params.id, req.body, req.user.id);
  res.status(201).json(result);
}
