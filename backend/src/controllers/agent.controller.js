import * as agent from '../services/agent.service.js';
import { enqueueRunNow } from '../queues/agent.queue.js';
import { hasFeature } from '../services/subscription.service.js';

export async function history(req, res) {
  const { targetType, targetId } = req.params;
  res.json(await agent.historyFor(req.params.workspaceId, targetType, targetId));
}

export async function settle(req, res) {
  res.json(await agent.settleFact(req.params.workspaceId, req.params.factId, {
    accepted: req.body?.accepted === true,
    userId: req.user.id,
  }));
}

// Runs the agent for this workspace now rather than waiting for the tick.
export async function runNow(req, res) {
  const { enabled } = await agent.getAgentSettings(req.params.workspaceId);
  if (!enabled) {
    res.status(409).json({ error: 'The autonomous agent is switched off for this workspace.' });
    return;
  }
  await enqueueRunNow(req.params.workspaceId);
  res.status(202).json({ queued: true });
}

// `planAllows` tells the screen whether to offer the switch or an upgrade.
// A workspace without a subscription row is on the free default, which does
// not include the agent.
export async function getSettings(req, res) {
  const { workspaceId } = req.params;
  const [settings, planAllows] = await Promise.all([
    agent.getAgentSettings(workspaceId),
    hasFeature(workspaceId, agent.AUTONOMOUS_AGENT_FEATURE).catch(() => false),
  ]);
  res.json({ ...settings, planAllows });
}

export async function updateSettings(req, res) {
  res.json(await agent.setAgentEnabled(req.params.workspaceId, req.body.enabled));
}

export async function pending(req, res) {
  res.json(await agent.pendingWork(req.params.workspaceId));
}

export async function cancelTask(req, res) {
  res.json(await agent.cancelTask(req.params.workspaceId, req.params.taskId));
}

export async function retryTask(req, res) {
  res.json(await agent.retryTask(req.params.workspaceId, req.params.taskId));
}

export async function expediteTask(req, res) {
  res.json(await agent.expediteTask(req.params.workspaceId, req.params.taskId));
}
