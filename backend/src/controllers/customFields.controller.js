import * as svc from '../services/customFields.service.js';
import * as wsFields from '../services/workspaceCustomFields.service.js';

export async function listFields(req, res) {
  res.json(await wsFields.listCustomFields(req.params.workspaceId));
}
export async function createField(req, res) {
  res.status(201).json(await wsFields.createCustomField(req.params.workspaceId, req.body || {}));
}
export async function updateField(req, res) {
  res.json(await wsFields.updateCustomField(req.params.workspaceId, req.params.id, req.body || {}));
}
export async function deleteField(req, res) {
  res.json(await wsFields.deleteCustomField(req.params.workspaceId, req.params.id));
}

export async function listEvents(req, res) {
  res.json(await wsFields.listCustomEvents(req.params.workspaceId));
}
export async function createEvent(req, res) {
  res.status(201).json(await wsFields.createCustomEvent(req.params.workspaceId, req.body || {}));
}
export async function deleteEvent(req, res) {
  res.json(await wsFields.deleteCustomEvent(req.params.workspaceId, req.params.id));
}
export async function trackEvent(req, res) {
  res.json(await wsFields.recordCustomEvent(req.params.workspaceId, req.params.key, req.body?.payload ?? {}));
}

// CRM (lead/deal) field definitions.
export async function list(req, res) {
  res.json(await svc.listDefinitions(req.params.workspaceId, req.query.entity, {
    includeInactive: req.query.includeInactive === 'true',
  }));
}
export async function create(req, res) {
  res.status(201).json(await svc.createDefinition(req.params.workspaceId, req.body));
}
export async function update(req, res) {
  res.json(await svc.updateDefinition(req.params.workspaceId, req.params.id, req.body));
}
export async function remove(req, res) {
  res.json(await svc.deleteDefinition(req.params.workspaceId, req.params.id));
}
