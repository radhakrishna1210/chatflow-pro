import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { authorize } from '../middleware/authorize.js';
import * as controller from '../controllers/crmCustomization.controller.js';

const router = Router({ mergeParams: true });

router.use(authenticate, workspaceContext);

router.get('/', controller.getAllCustomizations);
router.get('/:sectionKey/check-delete', controller.checkSafeDelete);
router.get('/:sectionKey', controller.getSection);
// Rewriting the workspace's CRM structure is an admin decision.
router.put('/:sectionKey', authorize('ADMIN'), controller.updateSection);
router.post('/:sectionKey/reset', authorize('ADMIN'), controller.resetSection);

export default router;
