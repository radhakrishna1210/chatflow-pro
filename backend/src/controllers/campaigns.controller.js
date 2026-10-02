import * as campaignsService from '../services/campaigns.service.js';
import { getExportableCampaign, campaignRecipientsCsv, exportFilename } from '../services/campaignExport.service.js';

export async function list(req, res) {
  const { page, limit } = req.query;
  const type = ['regular', 'authentication'].includes(String(req.query.type || '').toLowerCase())
    ? String(req.query.type).toLowerCase() : undefined;
  const result = await campaignsService.listCampaigns(req.params.workspaceId, { page: +page || 1, limit: +limit || 20, type });
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

// Replaces the audience outright, which is what editing a draft needs — adding
// is not enough, because a deselected contact has to actually come off.
export async function setRecipients(req, res) {
  const result = await campaignsService.setRecipients(req.params.workspaceId, req.params.id, req.body.contactIds);
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

export async function pause(req, res) {
  res.json(await campaignsService.pauseCampaign(req.params.workspaceId, req.params.id));
}

export async function resume(req, res) {
  res.json(await campaignsService.resumeCampaign(req.params.workspaceId, req.params.id));
}

export async function fallbackCapabilities(req, res) {
  const { fallbackCapabilities } = await import('../services/fallback.service.js');
  res.json(fallbackCapabilities());
}

// Every recipient of a campaign as CSV, streamed page by page. Headers go out
// only once the campaign is known to belong to this workspace, so a bad id is
// still a clean 404.
export async function exportRecipients(req, res) {
  const campaign = await getExportableCampaign(req.params.workspaceId, req.params.id);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${exportFilename(campaign)}"`);
  // A BOM so Excel opens non-ASCII names in the right encoding.
  res.write('﻿');
  try {
    for await (const chunk of campaignRecipientsCsv(campaign.id)) {
      if (!res.write(chunk)) await new Promise((resolve) => res.once('drain', resolve));
    }
  } catch (err) {
    // Too late for an error status; cut the download short so it cannot be
    // mistaken for a complete file.
    console.error(`[CampaignExport] Export of ${campaign.id} failed:`, err.message);
    res.destroy(err);
    return;
  }
  res.end();
}
