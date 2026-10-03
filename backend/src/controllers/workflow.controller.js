import * as workflowService from '../services/workflow.service.js';
import { listRuns, countRuns } from '../services/workflowEngine.service.js';

// Execution history for a workflow — "did this actually fire?" answered from
// the UI instead of from server logs.
//
// GET /workflows/runs?workflowId=&limit=&offset= — newest first, `limit`
// defaults to 20 (max 100). The body stays an array, as it always was; the
// total the filter can page through is in the X-Total-Count header.
export async function runs(req, res) {
  try {
    const workflowId = typeof req.query.workflowId === 'string' && req.query.workflowId.trim()
      ? req.query.workflowId.trim()
      : undefined;
    const { limit, offset } = req.query;
    const [page, total] = await Promise.all([
      listRuns(req.params.workspaceId, { workflowId, limit, offset }),
      countRuns(req.params.workspaceId, { workflowId }),
    ]);
    res.set('X-Total-Count', String(total));
    res.json(page);
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
