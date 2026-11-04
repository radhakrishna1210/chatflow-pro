import * as exportService from '../services/crmExport.service.js';
import * as importService from '../services/crmImport.service.js';

export async function exportCsv(req, res) {
  const maskPhone = req.query.maskPhone === 'true' || req.query.maskPhone === true;
  const { csv, filename, count, truncated } = await exportService.exportEntity(req.params.workspaceId, req.params.entity, { maskPhone });
  // Exports can contain customer contact details, so they are logged.
  console.log(`[export] workspace=${req.params.workspaceId} user=${req.user.id} entity=${req.params.entity} rows=${count} masked=${maskPhone}`);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('X-Export-Count', String(count));
  if (truncated) res.setHeader('X-Export-Truncated', 'true');
  // A BOM so Excel reads non-ASCII names as UTF-8 instead of mangling them
  // (the contact export already sends one).
  res.send('\uFEFF' + csv);
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
