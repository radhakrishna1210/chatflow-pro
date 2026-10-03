import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { authorize } from '../middleware/authorize.js';
import { requireFeature } from '../middleware/requireFeature.js';
import * as agentController from '../controllers/agent.controller.js';
import { AUTONOMOUS_AGENT_FEATURE } from '../services/agent.service.js';
import { validate, autonomousAgentSchemas } from '../validators/index.js';

// Mounted at /ai-agents/autonomous (the AI Agents area's one route family) and,
// for older clients, at /agent.
const router = Router({ mergeParams: true });
router.use(authenticate, workspaceContext);

// The autonomous agent is a plan feature. Anything that makes it do work —
// switching it on, running it, re-queueing a task — is gated like the other
// plan features; switching it off, cancelling work and reading what it did
// stay open, so a downgraded workspace can still see and stop it.
const requireAgentPlan = requireFeature(AUTONOMOUS_AGENT_FEATURE);
const requireAgentPlanToEnable = (req, res, next) =>
  (req.body?.enabled === true ? requireAgentPlan(req, res, next) : next());

// What the agent has done to one record — the Agent tab.
router.get('/history/:targetType/:targetId', agentController.history);

// The admin view of the queue: queued/running/failed tasks, suggestions
// waiting for a human, recent runs.
router.get('/pending', authorize('ADMIN'), agentController.pending);
router.post('/tasks/:taskId/cancel', authorize('ADMIN'), agentController.cancelTask);
router.post('/tasks/:taskId/run', authorize('ADMIN'), requireAgentPlan, agentController.expediteTask);
router.post('/tasks/:taskId/retry', authorize('ADMIN'), requireAgentPlan, agentController.retryTask);

// Settling a held-back suggestion is a human decision, so it needs the same
// authorisation any other write does.
router.patch('/facts/:factId', authorize('CLIENT'), agentController.settle);
router.post('/run', authorize('ADMIN'), requireAgentPlan, agentController.runNow);

// The workspace on/off switch. Turning on unattended CRM writes is held to the
// same role as running the agent on demand.
router.get('/settings', agentController.getSettings);
router.patch('/settings', authorize('ADMIN'), validate({ body: autonomousAgentSchemas.settings }), requireAgentPlanToEnable, agentController.updateSettings);

export default router;
