import { Router } from 'express';
import * as authService from '../services/auth.service.js';
import { authenticate } from '../middleware/authenticate.js';
import { validate, workspaceSchemas } from '../validators/index.js';

const router = Router();

// Explicit workspace creation — the only way a user becomes a workspace ADMIN.
// Returns a fresh session (tokens scoped to the new workspace).
router.post('/', authenticate, validate({ body: workspaceSchemas.create }), async (req, res) => {
  const result = await authService.createWorkspace(req.user.id, req.body);
  res.status(201).json(result);
});

// All workspaces the caller belongs to (for the workspace switcher) — global,
// not workspace-scoped, so it must be registered before the
// /workspaces/:workspaceId sub-router mount in routes/index.js (it already is).
router.get('/mine', authenticate, async (req, res) => {
  res.json(await authService.listMyWorkspaces(req.user.id));
});

export default router;
