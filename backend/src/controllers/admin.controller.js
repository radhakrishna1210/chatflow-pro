import * as adminService from '../services/admin.service.js';

export async function getPool(req, res) {
  const result = await adminService.getPoolSummary();
  res.json(result);
}

export async function addNumber(req, res) {
  const entry = await adminService.addToPool(req.body);
  res.status(201).json(entry);
}

export async function requestOtp(req, res) {
  const result = await adminService.sendOtpRequest(req.body);
  res.json(result);
}

export async function verifyOtp(req, res) {
  const entry = await adminService.verifyOtpAndAdd(req.body);
  res.status(201).json(entry);
}

export async function resetAllAssignments(req, res) {
  const result = await adminService.resetAllAssignments();
  res.json(result);
}

export async function resetPoolEntry(req, res) {
  const entry = await adminService.resetPoolEntry(req.params.id);
  res.json(entry);
}

export async function banPoolEntry(req, res) {
  const entry = await adminService.banPoolEntry(req.params.id);
  res.json(entry);
}

export async function twilioSync(req, res) {
  const result = await adminService.twilioSync();
  res.json(result);
}

export async function syncPoolFromWaba(req, res) {
  const result = await adminService.syncPoolFromWaba();
  res.json(result);
}

export async function getWabaNumbers(req, res) {
  const result = await adminService.getWabaNumbers();
  res.json(result);
}

export async function metaTestCalls(req, res) {
  const result = await adminService.metaTestCalls();
  res.json(result);
}

export async function listWorkspaces(req, res) {
  const workspaces = await adminService.listWorkspaces();
  res.json(workspaces);
}

export async function assignToWorkspace(req, res) {
  const { poolEntryId, workspaceId } = req.body;
  if (!poolEntryId || !workspaceId) {
    return res.status(400).json({ error: 'poolEntryId and workspaceId are required' });
  }
  const result = await adminService.assignToWorkspace(poolEntryId, workspaceId);
  res.status(201).json(result);
}
