import * as dealsService from '../services/deals.service.js';

export async function list(req, res) {
  const { stage, ownerUserId } = req.query;
  const result = await dealsService.listDeals(req.params.workspaceId, { stage, ownerUserId });
  res.json(result);
}

export async function get(req, res) {
  const result = await dealsService.getDeal(req.params.workspaceId, req.params.id);
  res.json(result);
}

export async function create(req, res) {
  const result = await dealsService.createDeal(req.params.workspaceId, req.body, req.user.id);
  res.status(201).json(result);
}

export async function update(req, res) {
  const result = await dealsService.updateDeal(req.params.workspaceId, req.params.id, req.body);
  res.json(result);
}

export async function updateStage(req, res) {
  const result = await dealsService.updateDealStage(req.params.workspaceId, req.params.id, req.body, req.user.id);
  res.json(result);
}

export async function remove(req, res) {
  await dealsService.deleteDeal(req.params.workspaceId, req.params.id);
  res.status(204).send();
}
