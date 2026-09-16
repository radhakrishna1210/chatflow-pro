import * as savedViewsService from '../services/savedViews.service.js';

export async function list(req, res) {
  const result = await savedViewsService.listSavedViews(req.params.workspaceId, req.user.id, {
    entity: req.query.entity,
  });
  res.json(result);
}

export async function create(req, res) {
  const result = await savedViewsService.createSavedView(req.params.workspaceId, req.user.id, req.body);
  res.status(201).json(result);
}

export async function update(req, res) {
  const result = await savedViewsService.updateSavedView(
    req.params.workspaceId, req.user.id, req.params.id, req.body,
  );
  res.json(result);
}

export async function remove(req, res) {
  await savedViewsService.deleteSavedView(req.params.workspaceId, req.user.id, req.params.id);
  res.status(204).send();
}
