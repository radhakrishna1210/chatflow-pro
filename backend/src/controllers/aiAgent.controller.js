import * as svc from '../services/aiAgent.service.js';

export async function getConfig(req, res) {
  res.json(await svc.getAgentConfig(req.params.workspaceId));
}
export async function updateConfig(req, res) {
  res.json(await svc.updateAgentConfig(req.params.workspaceId, req.body || {}));
}
export async function deploy(req, res) {
  res.json(await svc.deployAgent(req.params.workspaceId));
}
export async function undeploy(req, res) {
  res.json(await svc.undeployAgent(req.params.workspaceId));
}
export async function test(req, res) {
  const sample = (req.body?.message || '').trim();
  if (!sample) return res.status(400).json({ error: 'message is required' });
  res.json(await svc.testAgent(req.params.workspaceId, sample));
}
export async function setIntent(req, res) {
  res.json(await svc.setIntentMatching(req.params.workspaceId, req.body || {}));
}
