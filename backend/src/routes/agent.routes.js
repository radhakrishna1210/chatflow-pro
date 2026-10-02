import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { authorize } from '../middleware/authorize.js';
import * as agentController from '../controllers/agent.controller.js';
import { validate, autonomousAgentSchemas } from '../validators/index.js';

const router = Router({ mergeParams: true });
router.use(authenticate, workspaceContext);

// What the agent has done to one record — the Agent tab.
router.get('/history/:targetType/:targetId', agentController.history);
router.get('/pending', agentController.pending);

// Settling a held-back suggestion is a human decision, so it needs the same
// authorisation any other write does.
router.patch('/facts/:factId', authorize('CLIENT'), agentController.settle);
router.post('/run', authorize('ADMIN'), agentController.runNow);

// The workspace on/off switch. Turning on unattended CRM writes is held to the
// same role as running the agent on demand.
router.get('/settings', agentController.getSettings);
router.patch('/settings', authorize('ADMIN'), validate({ body: autonomousAgentSchemas.settings }), agentController.updateSettings);

export default router;
