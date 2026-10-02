import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { validate, reportSchemas } from '../validators/index.js';
import { requireCrmPermission, CRM_PERMISSIONS } from '../services/crmPermissions.service.js';
import * as crmAnalyticsController from '../controllers/crm-analytics.controller.js';
import * as customReportsController from '../controllers/customReports.controller.js';

const router = Router({ mergeParams: true });

router.use(authenticate, workspaceContext);

router.get('/', crmAnalyticsController.getAnalytics);
router.get('/integration-health', crmAnalyticsController.getIntegrationHealth);
router.post('/reports/query', validate({ body: reportSchemas.query }), customReportsController.queryReport);
router.get('/reports/saved', customReportsController.listSavedReports);
router.post('/reports/saved', requireCrmPermission(CRM_PERMISSIONS.CUSTOM_REPORTS_MANAGE), validate({ body: reportSchemas.save }), customReportsController.saveReport);
router.delete('/reports/saved/:id', requireCrmPermission(CRM_PERMISSIONS.CUSTOM_REPORTS_MANAGE), customReportsController.removeReport);

export default router;

