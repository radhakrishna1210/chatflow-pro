import { Router } from 'express';
import * as workflowController from '../controllers/workflow.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { authorize } from '../middleware/authorize.js';

const router = Router({ mergeParams: true });

router.use(authenticate, workspaceContext);

router.get('/', workflowController.list);
router.post('/', authorize('ADMIN', 'CLIENT'), workflowController.create);
router.patch('/:id', authorize('ADMIN', 'CLIENT'), workflowController.update);
router.delete('/:id', authorize('ADMIN', 'CLIENT'), workflowController.remove);

export default router;
