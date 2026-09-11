import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import * as controller from '../controllers/crmCustomization.controller.js';

const router = Router({ mergeParams: true });

router.use(authenticate, workspaceContext);

router.get('/', controller.getAllCustomizations);
router.get('/:sectionKey/check-delete', controller.checkSafeDelete);
router.get('/:sectionKey', controller.getSection);
router.put('/:sectionKey', controller.updateSection);
router.post('/:sectionKey/reset', controller.resetSection);

export default router;
