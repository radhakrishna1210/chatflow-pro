import * as crmAnalyticsService from '../services/crm-analytics.service.js';
import * as integrationHealthService from '../services/integrationHealth.service.js';

export async function getAnalytics(req, res) {
  const { userId, range } = req.query;
  const data = await crmAnalyticsService.getCrmAnalytics(req.params.workspaceId, { userId, range });
  res.json(data);
}

export async function getIntegrationHealth(req, res, next) {
  try {
    const data = await integrationHealthService.getIntegrationHealth(req.params.workspaceId);
    res.json(data);
  } catch (err) {
    next(err);
  }
}

