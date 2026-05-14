import * as campaignsService from '../services/campaigns.service.js';

export async function list(req, res) {
  const { page, limit } = req.query;
  const result = await campaignsService.listCampaigns(req.params.workspaceId, { page: +page || 1, limit: +limit || 20 });
  res.json(result);
}

export async function create(req, res) {
  const campaign = await campaignsService.createCampaign(req.params.workspaceId, req.body);
  res.status(201).json(campaign);
}

export async function addRecipients(req, res) {
  const result = await campaignsService.addRecipients(req.params.workspaceId, req.params.id, req.body.contactIds);
  res.json(result);
}

export async function launch(req, res) {
  const campaign = await campaignsService.launchCampaign(req.params.workspaceId, req.params.id, req.body.scheduledAt);
  res.json(campaign);
}

export async function getOne(req, res) {
  const campaign = await campaignsService.getCampaign(req.params.workspaceId, req.params.id);
  res.json(campaign);
}

export async function cancel(req, res) {
  const campaign = await campaignsService.cancelCampaign(req.params.workspaceId, req.params.id);
  res.json(campaign);
}
