import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { authorize } from '../middleware/authorize.js';
import { validate, leadDistributionSchemas } from '../validators/index.js';
import { requireCrmPermission, CRM_PERMISSIONS } from '../services/crmPermissions.service.js';
import * as leadDistributionController from '../controllers/leadDistribution.controller.js';

const router = Router({ mergeParams: true });

router.use(authenticate, workspaceContext);

router.get('/rules', leadDistributionController.getRules);
router.post('/rules', requireCrmPermission(CRM_PERMISSIONS.DISTRIBUTION_RULES_MANAGE), validate({ body: leadDistributionSchemas.rules }), leadDistributionController.updateRules);
router.post('/distribute', authorize('CLIENT'), validate({ body: leadDistributionSchemas.distribute }), leadDistributionController.distributeLeads);

export default router;
