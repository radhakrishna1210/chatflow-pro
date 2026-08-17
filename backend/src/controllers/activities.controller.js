import * as activitiesService from '../services/activities.service.js';

export async function list(req, res) {
  const { leadId, dealId, contactId } = req.query;
  const result = await activitiesService.listActivities(req.params.workspaceId, { leadId, dealId, contactId });
  res.json(result);
}

export async function create(req, res) {
  const result = await activitiesService.createActivity(req.params.workspaceId, req.body, req.user.id);
  res.status(201).json(result);
}

export async function remove(req, res) {
  await activitiesService.deleteActivity(req.params.workspaceId, req.params.id);
  res.status(204).send();
}
