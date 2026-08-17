import * as copilot from '../services/copilot.service.js';

export async function ask(req, res) {
  const result = await copilot.ask(
    req.params.workspaceId,
    req.user,
    req.body?.message,
    { history: Array.isArray(req.body?.history) ? req.body.history : [] },
  );
  res.json(result);
}

export async function confirm(req, res) {
  const result = await copilot.confirmProposal(req.params.workspaceId, req.user, {
    tool: req.body?.tool,
    args: req.body?.args,
  });
  res.json(result);
}
