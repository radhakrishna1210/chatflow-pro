import * as stagesService from '../services/pipelineStages.service.js';

export async function list(req, res) {
  res.json(await stagesService.listStages(req.params.workspaceId));
}

export async function update(req, res) {
  res.json(await stagesService.updateStage(req.params.workspaceId, req.params.key, req.body));
}

export async function reorder(req, res) {
  res.json(await stagesService.reorderStages(req.params.workspaceId, req.body.keys));
}
