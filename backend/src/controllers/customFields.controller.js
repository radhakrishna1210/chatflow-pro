import * as cfService from '../services/customFields.service.js';

export async function list(req, res) {
  res.json(await cfService.listDefinitions(req.params.workspaceId, req.query.entity, {
    includeInactive: req.query.includeInactive === 'true',
  }));
}
export async function create(req, res) {
  res.status(201).json(await cfService.createDefinition(req.params.workspaceId, req.body));
}
export async function update(req, res) {
  res.json(await cfService.updateDefinition(req.params.workspaceId, req.params.id, req.body));
}
export async function remove(req, res) {
  res.json(await cfService.deleteDefinition(req.params.workspaceId, req.params.id));
}
