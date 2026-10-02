import * as agent from '../services/agent.service.js';
import { enqueueRunNow } from '../queues/agent.queue.js';

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

export async function getSettings(req, res) {
  res.json(await agent.getAgentSettings(req.params.workspaceId));
}

export async function updateSettings(req, res) {
  res.json(await agent.setAgentEnabled(req.params.workspaceId, req.body.enabled));
}

export async function pending(req, res) {
  res.json(await agent.pendingWork(req.params.workspaceId));
}
