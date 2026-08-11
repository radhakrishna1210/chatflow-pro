import * as svc from '../services/aiAgent.service.js';

export async function getConfig(req, res) {
  res.json(await svc.getAgentConfig(req.params.workspaceId));
}
export async function updateConfig(req, res) {
  res.json(await svc.updateAgentConfig(req.params.workspaceId, req.body || {}));
}
// Upload a document into the agent's knowledge base. Appends, and reports any
// truncation rather than quietly dropping the overflow.
export async function uploadKnowledge(req, res) {
  if (!req.file) { res.status(400).json({ error: 'Attach a document to upload' }); return; }
  res.json(await svc.appendKnowledgeDocument(req.params.workspaceId, {
    buffer: req.file.buffer,
    fileName: req.file.originalname,
    mimeType: req.file.mimetype,
  }));
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
  const mode = req.body?.mode === 'campaign' ? 'campaign' : 'general';
  res.json(await svc.testAgent(req.params.workspaceId, sample, { mode, campaignId: req.body?.campaignId || null }));
}
export async function agents(req, res) {
  res.json(await svc.listAgents(req.params.workspaceId));
}
export async function campaignUsage(req, res) {
  res.json(await svc.listAgentCampaigns(req.params.workspaceId, req.query.agentId || null));
}
export async function setIntent(req, res) {
  res.json(await svc.setIntentMatching(req.params.workspaceId, req.body || {}));
}
