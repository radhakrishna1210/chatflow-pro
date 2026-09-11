import * as leadDistributionService from '../services/leadDistribution.service.js';

export async function getRules(req, res) {
  const result = await leadDistributionService.getDistributionRules(req.params.workspaceId);
  res.json(result);
}

export async function updateRules(req, res) {
  const result = await leadDistributionService.saveDistributionRules(req.params.workspaceId, req.body);
  res.json(result);
}

export async function distributeLeads(req, res) {
  const { leadIds } = req.body || {};
  const result = await leadDistributionService.autoDistributeBatch(req.params.workspaceId, leadIds);
  res.json(result);
}
