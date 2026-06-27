import * as workflowService from '../services/workflow.service.js';

export async function list(req, res) {
  try {
    const workflows = await workflowService.listWorkflows(req.params.workspaceId);
    // Parse JSON strings back to objects for frontend
    const parsed = workflows.map(w => ({
      ...w,
      nodes: typeof w.nodes === 'string' ? JSON.parse(w.nodes) : w.nodes,
      edges: typeof w.edges === 'string' ? JSON.parse(w.edges) : w.edges,
    }));
    res.json(parsed);
  } catch (err) {
    console.error('[Workflow] list error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Failed to list workflows' });
  }
}

export async function create(req, res) {
  try {
    const workflow = await workflowService.createWorkflow(req.params.workspaceId, req.body);
    const parsed = {
      ...workflow,
      nodes: typeof workflow.nodes === 'string' ? JSON.parse(workflow.nodes) : workflow.nodes,
      edges: typeof workflow.edges === 'string' ? JSON.parse(workflow.edges) : workflow.edges,
    };
    res.status(201).json(parsed);
  } catch (err) {
    console.error('[Workflow] create error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Failed to create workflow' });
  }
}

export async function update(req, res) {
  try {
    const workflow = await workflowService.updateWorkflow(req.params.workspaceId, req.params.id, req.body);
    const parsed = {
      ...workflow,
      nodes: typeof workflow.nodes === 'string' ? JSON.parse(workflow.nodes) : workflow.nodes,
      edges: typeof workflow.edges === 'string' ? JSON.parse(workflow.edges) : workflow.edges,
    };
    res.json(parsed);
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
