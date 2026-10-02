import * as aiAgentsService from '../services/aiAgents.service.js';

const getWsId = (req) => req.params.workspaceId || req.workspace?.id || req.user?.workspaceId;

// Services tag errors with an HTTP status (404 for a record outside this
// workspace, 400 for bad input); anything untagged is a server fault.
const fail = (res, err, fallback = 500) => res.status(err.status || fallback).json({ error: err.message });

export async function listAgents(req, res) {
  try {
    const agents = await aiAgentsService.listAgents(getWsId(req));
    res.json({ success: true, data: agents });
  } catch (err) {
    fail(res, err);
  }
}

export async function createAgent(req, res) {
  try {
    const agent = await aiAgentsService.createAgent(getWsId(req), req.user?.id, req.body);
    res.status(201).json({ success: true, data: agent });
  } catch (err) {
    fail(res, err);
  }
}

export async function updateAgent(req, res) {
  try {
    const updated = await aiAgentsService.updateAgent(getWsId(req), req.params.id, req.body, req.user?.id);
    res.json({ success: true, data: updated });
  } catch (err) {
    fail(res, err);
  }
}

export async function deleteAgent(req, res) {
  try {
    await aiAgentsService.deleteAgent(getWsId(req), req.params.id);
    res.json({ success: true });
  } catch (err) {
    fail(res, err);
  }
}

export async function listGuidelines(req, res) {
  try {
    const guidelines = await aiAgentsService.listGuidelines(getWsId(req));
    res.json({ success: true, data: guidelines });
  } catch (err) {
    fail(res, err);
  }
}

export async function listActions(req, res) {
  try {
    const actions = aiAgentsService.listActions();
    res.json({ success: true, data: actions });
  } catch (err) {
    fail(res, err);
  }
}

export async function executeAction(req, res) {
  try {
    const result = await aiAgentsService.executeAction(getWsId(req), req.body.actionId, req.body.params, req.user);
    res.json({ success: true, data: result });
  } catch (err) {
    fail(res, err);
  }
}

export async function testAgent(req, res) {
  try {
    const result = await aiAgentsService.testAgent(getWsId(req), req.params.id, req.body.message);
    res.json({ success: true, data: result });
  } catch (err) {
    fail(res, err);
  }
}

export async function listChannels(req, res) {
  try {
    const channels = await aiAgentsService.listChannels(getWsId(req));
    res.json({ success: true, data: channels });
  } catch (err) {
    fail(res, err);
  }
}

export async function updateChannel(req, res) {
  try {
    const result = await aiAgentsService.updateChannel(getWsId(req), req.params.channelKey, req.body, req.user?.id);
    res.json(result);
  } catch (err) {
    fail(res, err);
  }
}
