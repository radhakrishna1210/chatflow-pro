import * as exportService from '../services/crmExport.service.js';
import * as importService from '../services/crmImport.service.js';

export async function exportCsv(req, res) {
  const { csv, filename, count } = await exportService.exportEntity(req.params.workspaceId, req.params.entity);
  // Exports can contain customer contact details, so they are logged.
  console.log(`[export] workspace=${req.params.workspaceId} user=${req.user.id} entity=${req.params.entity} rows=${count}`);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}

export async function previewImport(req, res) {
  if (!req.file) { const e = new Error('No file uploaded'); e.status = 400; throw e; }
  res.json(importService.previewLeadImport(req.file.buffer));
}

export async function runImport(req, res) {
  if (!req.file) { const e = new Error('No file uploaded'); e.status = 400; throw e; }
  const ownerUserId = req.body?.ownerUserId || null;
  res.json(await importService.importLeads(req.params.workspaceId, req.file.buffer, { ownerUserId }));
}
