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

export default router;
