import * as analyticsService from '../services/analytics.service.js';

export async function overview(req, res) {
  const data = await analyticsService.getOverview(req.params.workspaceId, req.query.days);
  res.json(data);
}

export async function delivery(req, res) {
  const data = await analyticsService.getDeliveryStats(req.params.workspaceId, req.query.days);
  res.json(data);
}

export async function campaigns(req, res) {
  const data = await analyticsService.getCampaignStats(req.params.workspaceId, req.query.days);
  res.json(data);
}

export async function agents(req, res) {
  const data = await analyticsService.getAgentStats(req.params.workspaceId, req.query.days);
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

export async function paidMessages(req, res) {
  try {
    const data = await analyticsService.getPaidMessagesInsights(req.params.workspaceId, req.query.days);
    res.json(data);
  } catch (err) {
    console.error('Paid messages insights error:', err);
    res.status(500).json({ error: 'Unable to load paid messages insights' });
  }
}

// Audience analytics: list growth, retention cohorts and the engagement
// leaderboard behind the User Analytics page.
export async function audience(req, res) {
  try {
    res.json(await analyticsService.getAudienceAnalytics(req.params.workspaceId, req.query.weeks));
  } catch (err) {
    console.error('[Analytics] audience error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Failed to load audience analytics' });
  }
}

// Topic clusters, sentiment mix and knowledge gaps behind the Chat Analysis
// page. Computed from stored messages, not from a model call.
export async function insights(req, res) {
  try {
    res.json(await analyticsService.getConversationInsights(req.params.workspaceId, req.query.days));
  } catch (err) {
    console.error('[Analytics] insights error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Failed to load conversation insights' });
  }
}

// Funnel, AI/human resolution split and campaign leaderboard.
export async function performance(req, res) {
  try {
    res.json(await analyticsService.getPerformance(req.params.workspaceId, req.query.days));
  } catch (err) {
    console.error('[Analytics] performance error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Failed to load performance analytics' });
  }
}
