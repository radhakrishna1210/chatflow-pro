import { getAutomationPause } from '../services/automationPause.service.js';

// GET /workspaces/:workspaceId/conversations/:id/automation — whether
// automation is paused on a thread (human handoff), why, and when it resumes.
// Read by the inbox banner (WF-IN-1).
export async function automationStatus(req, res) {
  res.json(await getAutomationPause(req.params.workspaceId, req.params.id));
}
