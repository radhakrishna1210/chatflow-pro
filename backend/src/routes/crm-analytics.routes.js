import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { authorize } from '../middleware/authorize.js';
import { validate, reportSchemas } from '../validators/index.js';
import * as crmAnalyticsController from '../controllers/crm-analytics.controller.js';
import * as customReportsController from '../controllers/customReports.controller.js';

const router = Router({ mergeParams: true });

router.use(authenticate, workspaceContext);

router.get('/', crmAnalyticsController.getAnalytics);
router.get('/integration-health', crmAnalyticsController.getIntegrationHealth);
router.post('/reports/query', validate({ body: reportSchemas.query }), customReportsController.queryReport);
router.get('/reports/saved', customReportsController.listSavedReports);
router.post('/reports/saved', authorize('CLIENT'), validate({ body: reportSchemas.save }), customReportsController.saveReport);
router.delete('/reports/saved/:id', authorize('CLIENT'), customReportsController.removeReport);

export default router;

