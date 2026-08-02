import * as workflowService from '../services/workflow.service.js';
import { listRuns } from '../services/workflowEngine.service.js';

// Execution history for a workflow — "did this actually fire?" answered from
// the UI instead of from server logs.
export async function runs(req, res) {
  try {
    res.json(await listRuns(req.params.workspaceId, { workflowId: req.query.workflowId }));
  } catch (err) {
    console.error('[Workflow] runs error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Failed to list runs' });
  }
}

export async function list(req, res) {
  try {
    const workflows = await workflowService.listWorkflows(req.params.workspaceId);
    // Prisma Json columns come back as objects — no re-parsing needed.
    res.json(workflows);
  } catch (err) {
    console.error('[Workflow] list error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Failed to list workflows' });
  }
}

export async function create(req, res) {
  try {
    const workflow = await workflowService.createWorkflow(req.params.workspaceId, req.body);
    res.status(201).json(workflow);
  } catch (err) {
    console.error('[Workflow] create error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Failed to create workflow' });
  }
}

export async function update(req, res) {
  try {
    const workflow = await workflowService.updateWorkflow(req.params.workspaceId, req.params.id, req.body);
    res.json(workflow);
  } catch (err) {
    console.error('[Workflow] update error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Failed to update workflow' });
  }
}

export async function remove(req, res) {
  try {
    await workflowService.deleteWorkflow(req.params.workspaceId, req.params.id);
    res.status(204).send();
  } catch (err) {
    console.error('[Workflow] remove error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Failed to delete workflow' });
  }
}
