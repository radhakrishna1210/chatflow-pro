import * as svc from '../services/contextAgent.service.js';

export async function list(req, res) {
  res.json(await svc.listContextAgents(req.params.workspaceId));
}

export async function create(req, res) {
  res.status(201).json(await svc.createContextAgent(req.params.workspaceId, req.body || {}));
}

export async function update(req, res) {
  res.json(await svc.updateContextAgent(req.params.workspaceId, req.params.agentId, req.body || {}));
}

export async function remove(req, res) {
  res.json(await svc.deleteContextAgent(req.params.workspaceId, req.params.agentId));
}

// Upload a document as the agent's context. `mode=replace` swaps the context
// for the file; anything else appends. Truncation is reported, never silent.
export async function uploadContext(req, res) {
  if (!req.file) { res.status(400).json({ error: 'Attach a document to upload' }); return; }
  res.json(await svc.uploadContextDocument(req.params.workspaceId, req.params.agentId, {
    buffer: req.file.buffer,
    fileName: req.file.originalname,
    mimeType: req.file.mimetype,
    mode: req.body?.mode === 'replace' ? 'replace' : 'append',
  }));
}

export async function test(req, res) {
  const message = String(req.body?.message || '').trim();
  if (!message) { res.status(400).json({ error: 'message is required' }); return; }
  res.json(await svc.testContextAgent(
    req.params.workspaceId, req.params.agentId, message.slice(0, 2000), req.body?.history,
  ));
}
