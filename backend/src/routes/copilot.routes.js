import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { authorize } from '../middleware/authorize.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { validate, copilotSchemas } from '../validators/index.js';
import * as copilotController from '../controllers/copilot.controller.js';

const router = Router({ mergeParams: true });
router.use(authenticate, workspaceContext);

// Each turn can fan out to several database queries and an LLM call, and the
// provider key is a shared workspace resource — so a bounded bucket, well below
// what a person types but above what a UI retry needs.
router.post(
  '/ask',
  rateLimit({ windowMs: 60_000, max: 20, keyPrefix: 'copilot-ask' }),
  validate({ body: copilotSchemas.ask }),
  copilotController.ask,
);

// Executing a confirmed proposal is an ordinary write, so it carries the same
// CLIENT authorisation any other write does. The copilot cannot reach this —
// only a person clicking confirm can.
router.post(
  '/confirm',
  authorize('CLIENT'),
  validate({ body: copilotSchemas.confirm }),
  copilotController.confirm,
);

export default router;
