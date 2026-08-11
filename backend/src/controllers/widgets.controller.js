import * as widgetService from '../services/widget.service.js';
import * as knowledge from '../services/workspaceKnowledge.service.js';

// Widget management, for the workspace owner. The visitor-facing endpoints are
// in widgetPublic.controller.js.

export async function list(req, res) {
  res.json(await widgetService.listWidgets(req.params.workspaceId));
}

export async function getOne(req, res) {
  res.json(await widgetService.getWidget(req.params.workspaceId, req.params.id));
}

export async function create(req, res) {
  res.status(201).json(await widgetService.createWidget(req.params.workspaceId, req.body));
}

export async function update(req, res) {
  res.json(await widgetService.updateWidget(req.params.workspaceId, req.params.id, req.body));
}

export async function remove(req, res) {
  await widgetService.deleteWidget(req.params.workspaceId, req.params.id);
  res.status(204).send();
}

export async function rotateKey(req, res) {
  res.json(await widgetService.rotateKey(req.params.workspaceId, req.params.id));
}

export async function analytics(req, res) {
  res.json(await widgetService.widgetAnalytics(req.params.workspaceId, {
    widgetId: req.query.widgetId || null,
    days: +req.query.days || 30,
  }));
}

export async function sessions(req, res) {
  res.json(await widgetService.recentSessions(req.params.workspaceId, {
    widgetId: req.query.widgetId || null,
    limit: +req.query.limit || 20,
  }));
}

// ─── knowledge sources ───────────────────────────────────────────────────────
//
// The corpus the widget's assistant answers from. Lives under /widgets because
// that is the only thing that reads it today, but it is workspace-wide rather
// than per-widget: two widgets on the same site answer from the same knowledge.

export async function listSources(req, res) {
  res.json(await knowledge.listSources(req.params.workspaceId));
}

export async function createSource(req, res) {
  res.status(201).json(await knowledge.createSource(req.params.workspaceId, req.body));
}

export async function updateSource(req, res) {
  res.json(await knowledge.updateSource(req.params.workspaceId, req.params.sourceId, req.body));
}

export async function refreshSource(req, res) {
  res.json(await knowledge.refreshSource(req.params.workspaceId, req.params.sourceId));
}

export async function removeSource(req, res) {
  await knowledge.deleteSource(req.params.workspaceId, req.params.sourceId);
  res.status(204).send();
}

// Re-embedding spends the platform's embedding quota, so it is an explicit
// action rather than something that happens on every content edit.
export async function reindex(req, res) {
  res.json(await knowledge.reindexWorkspace(req.params.workspaceId, {
    force: req.body?.force === true,
    refresh: req.body?.refresh !== false,
  }));
}

export async function knowledgeStatus(req, res) {
  res.json(await knowledge.knowledgeStatus(req.params.workspaceId));
}
