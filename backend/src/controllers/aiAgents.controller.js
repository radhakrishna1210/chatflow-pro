import * as aiAgentsService from '../services/aiAgents.service.js';

const getWsId = (req) => req.params.workspaceId || req.workspace?.id || req.user?.workspaceId;

export async function listAgents(req, res) {
  try {
    const agents = await aiAgentsService.listAgents(getWsId(req));
    res.json({ success: true, data: agents });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function createAgent(req, res) {
  try {
    const agent = await aiAgentsService.createAgent(getWsId(req), req.user?.id, req.body);
    res.status(201).json({ success: true, data: agent });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function updateAgent(req, res) {
  try {
    const updated = await aiAgentsService.updateAgent(getWsId(req), req.params.id, req.body, req.user?.id);
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function deleteAgent(req, res) {
  try {
    await aiAgentsService.deleteAgent(getWsId(req), req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function listGuidelines(req, res) {
  try {
    const guidelines = await aiAgentsService.listGuidelines(getWsId(req));
    res.json({ success: true, data: guidelines });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function listActions(req, res) {
  try {
    const actions = aiAgentsService.listActions();
    res.json({ success: true, data: actions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function executeAction(req, res) {
  try {
    const result = await aiAgentsService.executeAction(getWsId(req), req.body.actionId, req.body.params);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function testAgent(req, res) {
  try {
    const result = await aiAgentsService.testAgent(getWsId(req), req.params.id, req.body.message);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function listChannels(req, res) {
  try {
    const channels = await aiAgentsService.listChannels(getWsId(req));
    res.json({ success: true, data: channels });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function updateChannel(req, res) {
  try {
    const result = await aiAgentsService.updateChannel(getWsId(req), req.params.channelKey, req.body, req.user?.id);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}
