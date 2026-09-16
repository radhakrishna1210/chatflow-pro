import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import * as insightsController from '../controllers/insights.controller.js';

const router = Router({ mergeParams: true });
router.use(authenticate, workspaceContext);

// Read-only: these derive from records the caller can already see, and are
// scoped by the same record-visibility rules.
router.get('/recommendations', insightsController.recommendations);
router.get('/relationship/:contactId', insightsController.relationship);

export default router;
