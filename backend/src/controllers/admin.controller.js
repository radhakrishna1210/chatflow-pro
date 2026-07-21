import * as adminService from '../services/admin.service.js';
import * as authService from '../services/auth.service.js';

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

export async function platformStats(req, res) {
  res.json(await adminService.getPlatformStats());
}

export async function listWorkspacesDetailed(req, res) {
  res.json(await adminService.listWorkspacesDetailed());
}

export async function suspendWorkspace(req, res) {
  const { suspended, reason } = req.body;
  const result = await adminService.setWorkspaceSuspended(req.params.id, suspended, reason);
  res.json(result);
}

export async function listTickets(req, res) {
  res.json(await adminService.listAllTickets(req.query.status));
}

export async function updateTicket(req, res) {
  res.json(await adminService.updateTicket(req.params.id, req.body || {}));
}

export async function transactionAnalysis(req, res) {
  const { workspaceId, from, to, type } = req.query;
  res.json(await adminService.getTransactionAnalysis({ workspaceId, from, to, type }));
}

export async function listAllCampaigns(req, res) {
  const { workspaceId, status } = req.query;
  res.json(await adminService.listAllCampaigns({ workspaceId, status }));
}

export async function revenueOverview(req, res) {
  res.json(await adminService.getRevenueOverview());
}

export async function workspaceAnalytics(req, res) {
  res.json(await adminService.getWorkspaceAnalytics());
}

export async function paymentsAnalysis(req, res) {
  const { workspaceId, from, to } = req.query;
  res.json(await adminService.getPaymentsAnalysis({ workspaceId, from, to }));
}

export async function workspaceMembers(req, res) {
  res.json(await adminService.getWorkspaceMembers(req.params.id));
}

export async function listUsers(req, res) {
  const { search, page, limit } = req.query;
  res.json(await adminService.listUsers({ search, page, limit }));
}

export async function impersonateUser(req, res) {
  res.json(await authService.impersonateUser(req.params.id));
}

// ─── Plan management ──────────────────────────────────────────
export async function listPlans(req, res) {
  res.json({ plans: await adminService.listAllPlans(), knownFeatures: adminService.KNOWN_FEATURE_FLAGS });
}

export async function createPlan(req, res) {
  res.status(201).json(await adminService.createPlan(req.body || {}));
}

export async function updatePlan(req, res) {
  res.json(await adminService.updatePlan(req.params.id, req.body || {}));
}

export async function deletePlan(req, res) {
  res.json(await adminService.deletePlan(req.params.id));
}
