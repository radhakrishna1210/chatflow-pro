import * as leadsService from '../services/leads.service.js';

export async function list(req, res) {
  const { category, status, ownerUserId, search, sort, preset, awaitingTask, uncontacted } = req.query;
  const result = await leadsService.listLeads(
    req.params.workspaceId,
    {
      category,
      status,
      ownerUserId,
      search,
      sort,
      preset,
      awaitingTask: awaitingTask === 'true' || awaitingTask === true,
      uncontacted: uncontacted === 'true' || uncontacted === true,
    },
    req.user
  );
  res.json(result);
}

export async function get(req, res) {
  const result = await leadsService.getLead(req.params.workspaceId, req.params.id, req.user);
  res.json(result);
}

export async function create(req, res) {
  const result = await leadsService.createLead(req.params.workspaceId, req.body);
  res.status(201).json(result);
}

export async function update(req, res) {
  const result = await leadsService.updateLead(req.params.workspaceId, req.params.id, req.body, req.user);
  res.json(result);
}

export async function remove(req, res) {
  await leadsService.deleteLead(req.params.workspaceId, req.params.id, req.user);
  res.status(204).send();
}

export async function bulkRemove(req, res) {
  const { ids } = req.body;
  const result = await leadsService.deleteLeads(req.params.workspaceId, ids, req.user);
  res.json(result);
}

export async function bulkAssign(req, res) {
  const { ids, ownerUserId } = req.body || {};
  const result = await leadsService.bulkAssignLeads(req.params.workspaceId, ids, ownerUserId, req.user);
  res.json(result);
}

export async function bulkStatus(req, res) {
  const { ids, status } = req.body || {};
  const result = await leadsService.bulkUpdateStatus(req.params.workspaceId, ids, status, req.user);
  res.json(result);
}

export async function bulkCategory(req, res) {
  const { ids, category } = req.body || {};
  const result = await leadsService.bulkUpdateCategory(req.params.workspaceId, ids, category, req.user);
  res.json(result);
}

export async function bulkTask(req, res) {
  const { ids, title, dueDate, priority } = req.body || {};
  const result = await leadsService.bulkCreateTask(req.params.workspaceId, ids, { title, dueDate, priority }, req.user.id);
  res.json(result);
}

export async function recalculateScore(req, res) {
  const result = await leadsService.recalculateScore(req.params.workspaceId, req.params.id, req.user);
  res.json(result);
}

export async function convert(req, res) {
  const result = await leadsService.convertLead(req.params.workspaceId, req.params.id, req.body, req.user.id);
  res.status(201).json(result);
}
