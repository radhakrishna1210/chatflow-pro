import * as automationService from '../services/automation.service.js';

export async function list(req, res) {
  const triggers = await automationService.listTriggers(req.params.workspaceId);
  res.json(triggers);
}

export async function create(req, res) {
  const trigger = await automationService.createTrigger(req.params.workspaceId, req.body);
  res.status(201).json(trigger);
}

export async function update(req, res) {
  const trigger = await automationService.updateTrigger(req.params.workspaceId, req.params.id, req.body);
  res.json(trigger);
}

export async function remove(req, res) {
  await automationService.deleteTrigger(req.params.workspaceId, req.params.id);
  res.status(204).send();
}
