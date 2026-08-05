import * as campaignsService from '../services/campaigns.service.js';

export async function list(req, res) {
  const { page, limit } = req.query;
  const result = await campaignsService.listCampaigns(req.params.workspaceId, { page: +page || 1, limit: +limit || 20 });
  res.json(result);
}

export async function create(req, res) {
  const campaign = await campaignsService.createCampaign(req.params.workspaceId, req.body, req.user);
  res.status(201).json(campaign);
}

// Pre-launch summary: valid/duplicate/blocked/invalid recipients, cost per
// message, total campaign cost and the wallet balance before and after.
export async function estimate(req, res) {
  const summary = await campaignsService.estimateCampaignCost(req.params.workspaceId, {
    contactIds: req.body?.contactIds,
    campaignId: req.body?.campaignId,
    templateId: req.body?.templateId,
  });
  res.json(summary);
}

export async function addRecipients(req, res) {
  const result = await campaignsService.addRecipients(req.params.workspaceId, req.params.id, req.body.contactIds);
  res.json(result);
}

export async function update(req, res) {
  const campaign = await campaignsService.updateCampaign(req.params.workspaceId, req.params.id, req.body);
  res.json(campaign);
}

export async function launch(req, res) {
  const campaign = await campaignsService.launchCampaign(
    req.params.workspaceId, req.params.id, req.body.scheduledAt, req.body.retryConfig, req.user,
  );
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

export async function fallbackCapabilities(req, res) {
  const { fallbackCapabilities } = await import('../services/fallback.service.js');
  res.json(fallbackCapabilities());
}
