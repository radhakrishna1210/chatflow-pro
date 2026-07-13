import * as templatesService from '../services/templates.service.js';

export async function list(req, res) {
  // Optional ?waNumberId= filters to one number's private templates.
  const templates = await templatesService.listTemplates(req.params.workspaceId, req.query.waNumberId);
  res.json(templates);
}

export async function create(req, res) {
  const template = await templatesService.createTemplate(req.params.workspaceId, req.body);
  res.status(201).json(template);
}

export async function getOne(req, res) {
  const template = await templatesService.getTemplate(req.params.workspaceId, req.params.id);
  res.json(template);
}

export async function update(req, res) {
  const template = await templatesService.updateTemplate(req.params.workspaceId, req.params.id, req.body);
  res.json(template);
}

export async function remove(req, res) {
  await templatesService.deleteTemplate(req.params.workspaceId, req.params.id);
  res.status(204).send();
}

export async function duplicate(req, res) {
  const template = await templatesService.duplicateTemplate(req.params.workspaceId, req.params.id);
  res.status(201).json(template);
}

export async function syncFromMeta(req, res) {
  const result = await templatesService.syncTemplatesFromMeta(req.params.workspaceId, req.body?.waNumberId || req.query?.waNumberId);
  res.json(result);
}

export async function library(req, res) {
  const items = await templatesService.listLibrary(req.params.workspaceId);
  res.json(items);
}

export async function installLibrary(req, res) {
  const tpl = await templatesService.installFromLibrary(req.params.workspaceId, req.params.libId, req.body?.waNumberId);
  res.status(201).json(tpl);
}
