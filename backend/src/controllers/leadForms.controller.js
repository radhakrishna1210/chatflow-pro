import * as formsService from '../services/leadForms.service.js';

// ── Authenticated (workspace) ──────────────────────────────────────────────
export async function list(req, res) {
  res.json(await formsService.listForms(req.params.workspaceId));
}
export async function get(req, res) {
  res.json(await formsService.getForm(req.params.workspaceId, req.params.id));
}
export async function create(req, res) {
  res.status(201).json(await formsService.createForm(req.params.workspaceId, req.body));
}
export async function update(req, res) {
  res.json(await formsService.updateForm(req.params.workspaceId, req.params.id, req.body));
}
export async function remove(req, res) {
  await formsService.deleteForm(req.params.workspaceId, req.params.id);
  res.status(204).send();
}

// ── Public (unauthenticated) ───────────────────────────────────────────────
const clientIp = (req) =>
  req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || req.socket?.remoteAddress || null;

export async function publicGet(req, res) {
  res.json(await formsService.getPublicForm(req.params.workspaceId, req.params.slug));
}
export async function publicSubmit(req, res) {
  const result = await formsService.submitForm(
    req.params.workspaceId, req.params.slug, req.body, { ip: clientIp(req) },
  );
  res.json(result);
}
