import * as compiler from '../services/workflowCompiler.service.js';

export async function compile(req, res) {
  const result = await compiler.compile(req.params.workspaceId, req.body?.description, {
    name: req.body?.name,
  });
  // 201: a draft workflow now exists. It is inactive — activating it is a
  // separate, deliberate act through the normal workflow endpoint.
  res.status(201).json({
    workflow: result.workflow,
    summary: result.summary,
    warnings: result.warnings,
    active: false,
  });
}

export function vocabulary(_req, res) {
  res.json({
    triggers: Object.keys(compiler.TRIGGERS),
    actions: Object.keys(compiler.ACTIONS),
  });
}
