import * as lineService from '../services/dealLineItems.service.js';

export async function list(req, res) {
  res.json(await lineService.listDealLineItems(req.params.workspaceId, req.params.id));
}
export async function create(req, res) {
  res.status(201).json(await lineService.addDealLineItem(req.params.workspaceId, req.params.id, req.body));
}
export async function update(req, res) {
  res.json(await lineService.updateDealLineItem(req.params.workspaceId, req.params.id, req.params.lineId, req.body));
}
export async function remove(req, res) {
  await lineService.deleteDealLineItem(req.params.workspaceId, req.params.id, req.params.lineId);
  res.status(204).send();
}
