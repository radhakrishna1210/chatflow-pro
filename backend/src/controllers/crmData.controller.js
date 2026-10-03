import * as exportService from '../services/crmExport.service.js';
import * as importService from '../services/crmImport.service.js';
import * as audit from '../services/audit.service.js';
import { hasCrmPermission, CRM_PERMISSIONS } from '../services/crmPermissions.service.js';
import { assertWorkspaceMember } from '../services/crmReferences.js';
import { workspacePhoneCountry } from '../lib/phone.js';

export async function exportCsv(req, res) {
  // Unmasked numbers need the override permission; anyone may ask for masking.
  const maskPhone = req.query.maskPhone === 'true' || req.query.maskPhone === true
    || !hasCrmPermission(req.user?.role, CRM_PERMISSIONS.PHONE_MASKING_OVERRIDE);
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
  const [rules, country] = await Promise.all([
    importService.loadImportRules(req.params.workspaceId),
    workspacePhoneCountry(req.params.workspaceId),
  ]);
  res.json(importService.previewLeadImport(req.file.buffer, { rules, country }));
}

export async function runImport(req, res) {
  if (!req.file) { const e = new Error('No file uploaded'); e.status = 400; throw e; }
  const ownerUserId = req.body?.ownerUserId || null;
  if (ownerUserId) await assertWorkspaceMember(req.params.workspaceId, ownerUserId, 'Owner');
  res.json(await importService.importLeads(req.params.workspaceId, req.file.buffer, { ownerUserId }));
}
