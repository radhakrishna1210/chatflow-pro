import * as activitiesService from '../services/activities.service.js';

export async function list(req, res, next) {
  try {
    const { leadId, dealId, contactId, type, search, ownerUserId, page, limit } = req.query;
    const result = await activitiesService.listActivities(req.params.workspaceId, {
      leadId,
      dealId,
      contactId,
      type,
      search,
      ownerUserId,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 200,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function create(req, res) {
  const result = await activitiesService.createActivity(req.params.workspaceId, req.body, req.user.id);
  res.status(201).json(result);
}

export async function remove(req, res) {
  await activitiesService.deleteActivity(req.params.workspaceId, req.params.id);
  res.status(204).send();
}
