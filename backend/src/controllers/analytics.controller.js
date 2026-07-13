import * as analyticsService from '../services/analytics.service.js';

export async function overview(req, res) {
  const data = await analyticsService.getOverview(req.params.workspaceId);
  res.json(data);
}

export async function delivery(req, res) {
  const data = await analyticsService.getDeliveryStats(req.params.workspaceId);
  res.json(data);
}

export async function campaigns(req, res) {
  const data = await analyticsService.getCampaignStats(req.params.workspaceId);
  res.json(data);
}

export async function agents(req, res) {
  const data = await analyticsService.getAgentStats(req.params.workspaceId);
  res.json(data);
}

export async function getChatAnalytics(req, res) {
  try {
    const data = await analyticsService.getChatAnalytics(req.params.workspaceId, req.query.days);
    res.json(data);
  } catch (err) {
    console.error('Chat analytics error:', err);
    res.status(500).json({ error: 'Unable to load chat analytics' });
  }
}
