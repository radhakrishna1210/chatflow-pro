import * as svc from '../services/customFields.service.js';

export async function listFields(req, res) {
  res.json(await svc.listCustomFields(req.params.workspaceId));
}
export async function createField(req, res) {
  res.status(201).json(await svc.createCustomField(req.params.workspaceId, req.body || {}));
}
export async function updateField(req, res) {
  res.json(await svc.updateCustomField(req.params.workspaceId, req.params.id, req.body || {}));
}
export async function deleteField(req, res) {
  res.json(await svc.deleteCustomField(req.params.workspaceId, req.params.id));
}

export async function listEvents(req, res) {
  res.json(await svc.listCustomEvents(req.params.workspaceId));
}
export async function createEvent(req, res) {
  res.status(201).json(await svc.createCustomEvent(req.params.workspaceId, req.body || {}));
}
export async function deleteEvent(req, res) {
  res.json(await svc.deleteCustomEvent(req.params.workspaceId, req.params.id));
}
export async function trackEvent(req, res) {
  res.json(await svc.recordCustomEvent(req.params.workspaceId, req.params.key, req.body?.payload ?? {}));
}
