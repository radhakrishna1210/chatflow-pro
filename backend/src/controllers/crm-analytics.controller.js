import * as crmAnalyticsService from '../services/crm-analytics.service.js';

export async function getAnalytics(req, res) {
  const { userId } = req.query;
  const data = await crmAnalyticsService.getCrmAnalytics(req.params.workspaceId, { userId });
  res.json(data);
}
