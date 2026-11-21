import * as agent from '../services/onboardingAgent.service.js';
import { listAiCreditUsage } from '../services/aiCredits.service.js';

// Errors from the agent carry a `code` the screen acts on (out of credits, a
// blueprint that cannot be applied), so they are answered here rather than by
// the generic handler, which would drop it.
const guarded = (handler) => async (req, res, next) => {
  try {
    await handler(req, res);
  } catch (err) {
    if (err?.status && err.status < 500 || err?.status === 502 || err?.status === 503) {
      res.status(err.status).json({
        error: err.message,
        ...(err.code ? { code: err.code } : {}),
        ...(err.feature ? { feature: err.feature } : {}),
      });
      return;
    }
    next(err);
  }
};

const ws = (req) => req.params.workspaceId;

export const list = guarded(async (req, res) => {
  res.json(await agent.listBuilds(ws(req)));
});

export const get = guarded(async (req, res) => {
  res.json(await agent.getBuild(ws(req), req.params.id));
});

export const create = guarded(async (req, res) => {
  res.status(201).json(await agent.createBuild(ws(req), req.user.id, req.body));
});

export const message = guarded(async (req, res) => {
  res.json(await agent.sendMessage(ws(req), req.user.id, req.params.id, req.body));
});

export const updateItem = guarded(async (req, res) => {
  res.json(await agent.updateItem(ws(req), req.params.id, req.params.key, req.body.item));
});

export const removeItem = guarded(async (req, res) => {
  res.json(await agent.removeItem(ws(req), req.params.id, req.params.key));
});

export const apply = guarded(async (req, res) => {
  res.json(await agent.applyBuild(ws(req), req.params.id, req.body));
});

export const live = guarded(async (req, res) => {
  res.json(await agent.setLive(ws(req), req.params.id, req.body.on));
});

export const remove = guarded(async (req, res) => {
  res.json(await agent.deleteBuild(ws(req), req.params.id));
});

export const usage = guarded(async (req, res) => {
  res.json({ usage: await listAiCreditUsage(ws(req), { limit: req.query.limit }) });
});
