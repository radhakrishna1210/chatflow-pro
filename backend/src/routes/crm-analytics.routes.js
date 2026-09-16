import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { authorize } from '../middleware/authorize.js';
import * as crmAnalyticsController from '../controllers/crm-analytics.controller.js';
import * as customReportsController from '../controllers/customReports.controller.js';

const router = Router({ mergeParams: true });

router.use(authenticate, workspaceContext);

router.get('/', crmAnalyticsController.getAnalytics);
router.get('/integration-health', crmAnalyticsController.getIntegrationHealth);
router.post('/reports/query', customReportsController.queryReport);
router.get('/reports/saved', customReportsController.listSavedReports);
router.post('/reports/saved', authorize('CLIENT'), customReportsController.saveReport);
router.delete('/reports/saved/:id', authorize('CLIENT'), customReportsController.removeReport);

export default router;

