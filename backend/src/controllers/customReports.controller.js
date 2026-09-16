import * as customReportsService from '../services/customReports.service.js';

export async function queryReport(req, res) {
  const result = await customReportsService.executeCustomReport(req.params.workspaceId, req.body);
  res.json(result);
}

export async function listSavedReports(req, res) {
  const result = await customReportsService.listSavedReports(req.params.workspaceId, req.user?.id);
  res.json(result);
}

export async function saveReport(req, res) {
  const result = await customReportsService.saveCustomReport(req.params.workspaceId, req.body, req.user?.id);
  res.status(201).json(result);
}

export async function removeReport(req, res) {
  await customReportsService.deleteSavedReport(req.params.workspaceId, req.params.id, req.user?.id);
  res.status(204).send();
}
