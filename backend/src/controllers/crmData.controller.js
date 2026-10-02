import * as exportService from '../services/crmExport.service.js';
import * as importService from '../services/crmImport.service.js';
import * as audit from '../services/audit.service.js';

export async function exportCsv(req, res) {
  const maskPhone = req.query.maskPhone === 'true' || req.query.maskPhone === true;
  const { csv, filename, count } = await exportService.exportEntity(req.params.workspaceId, req.params.entity, { maskPhone });
  // Exports can contain customer contact details, so they are logged.
  console.log(`[export] workspace=${req.params.workspaceId} user=${req.user.id} entity=${req.params.entity} rows=${count} masked=${maskPhone}`);
  await audit.record({
    actor: req.user,
    action: 'crm.export',
    targetType: 'workspace',
    targetLabel: req.params.workspaceId,
    meta: { entity: req.params.entity, rows: count, masked: maskPhone },
  });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}

export async function previewImport(req, res) {
  if (!req.file) { const e = new Error('No file uploaded'); e.status = 400; throw e; }
  const customStatuses = await importService.loadCustomStatuses(req.params.workspaceId);
  res.json(importService.previewLeadImport(req.file.buffer, { customStatuses }));
}

export async function runImport(req, res) {
  if (!req.file) { const e = new Error('No file uploaded'); e.status = 400; throw e; }
  const ownerUserId = req.body?.ownerUserId || null;
  res.json(await importService.importLeads(req.params.workspaceId, req.file.buffer, { ownerUserId }));
}
