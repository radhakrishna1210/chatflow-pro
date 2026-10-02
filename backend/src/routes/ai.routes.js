import { Router } from 'express';
import { createTemplate, createCampaign, updateCampaign, updateTemplate, executeWorkflow } from '../controllers/ai.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { authorize } from '../middleware/authorize.js';
import { requireFeature } from '../middleware/requireFeature.js';

// Mounted under /workspaces/:workspaceId/ai so these writes get the same
// membership, role, suspension and subscription checks as the screens they
// draft for.
const router = Router({ mergeParams: true });

router.use(authenticate, workspaceContext, authorize('CLIENT'));

router.post('/template/create', createTemplate);
router.post('/campaign/create', createCampaign);
router.post('/campaign/update', updateCampaign);
router.post('/template/update', updateTemplate);
router.post('/workflow/execute', requireFeature('workflows'), executeWorkflow);

export default router;
