import { Router } from 'express';
import * as crmSalesInboxController from '../controllers/crmSalesInbox.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';

const router = Router({ mergeParams: true });

router.use(authenticate, workspaceContext);

router.get('/segments', crmSalesInboxController.getSegments);
router.get('/audience-review', crmSalesInboxController.reviewAudience);
router.post('/leads/:leadId/recalculate-category', crmSalesInboxController.recalculateLeadCategory);
router.post('/launch-bulk-campaign', crmSalesInboxController.launchBulkCampaign);

export default router;
