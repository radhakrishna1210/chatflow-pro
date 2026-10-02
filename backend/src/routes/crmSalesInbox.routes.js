import { Router } from 'express';
import * as crmSalesInboxController from '../controllers/crmSalesInbox.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';

import { authorize } from '../middleware/authorize.js';
import { validate, crmSalesInboxSchemas } from '../validators/index.js';

const router = Router({ mergeParams: true });

router.use(authenticate, workspaceContext);

router.get('/segments', crmSalesInboxController.getSegments);
router.get('/audience-review', validate({ query: crmSalesInboxSchemas.audience }), crmSalesInboxController.reviewAudience);
router.get('/campaign-analytics', crmSalesInboxController.getCampaignAnalytics);
router.post('/leads/:leadId/recalculate-category', authorize('CLIENT'), crmSalesInboxController.recalculateLeadCategory);
router.post('/launch-bulk-campaign', authorize('CLIENT'), validate({ body: crmSalesInboxSchemas.launch }), crmSalesInboxController.launchBulkCampaign);

export default router;


