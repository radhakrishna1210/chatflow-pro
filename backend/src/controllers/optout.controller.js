import * as optOutService from '../services/optout.service.js';

export async function list(req, res) {
  const { search, status, page, limit } = req.query;
  const result = await optOutService.listOptOuts(req.params.workspaceId, {
    search, status, page: +page || 1, limit: +limit || 50,
  });
  res.json(result);
}

export async function keywords(req, res) {
  res.json({ keywords: optOutService.listOptOutKeywords() });
}

export async function block(req, res) {
  const row = await optOutService.blockNumberManually(req.params.workspaceId, req.body, req.user);
  res.status(201).json(row);
}

// Handles both a single unblock (:id) and a bulk unblock ({ ids: [...] }).
export async function unblock(req, res) {
  const ids = req.params.id ? [req.params.id] : req.body?.ids;
  const result = await optOutService.unblockNumbers(req.params.workspaceId, ids, req.user?.id);
  res.json(result);
}

export async function exportCsv(req, res) {
  const csv = await optOutService.exportOptOutsCsv(req.params.workspaceId, {
    status: req.query.status, search: req.query.search,
  });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="blocked-numbers-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv);
}
