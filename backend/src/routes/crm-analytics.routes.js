import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import * as crmAnalyticsController from '../controllers/crm-analytics.controller.js';

const router = Router({ mergeParams: true });

router.use(authenticate, workspaceContext);

router.get('/', crmAnalyticsController.getAnalytics);

export default router;
