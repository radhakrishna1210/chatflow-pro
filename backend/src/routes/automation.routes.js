import { Router } from 'express';
import * as automationController from '../controllers/automation.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { authorize } from '../middleware/authorize.js';

const router = Router({ mergeParams: true });

router.use(authenticate, workspaceContext);

router.get('/triggers', automationController.list);
router.post('/triggers', authorize('CLIENT'), automationController.create);
router.patch('/triggers/:id', authorize('CLIENT'), automationController.update);
router.delete('/triggers/:id', authorize('CLIENT'), automationController.remove);

export default router;
