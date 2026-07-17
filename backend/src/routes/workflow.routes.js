import { Router } from 'express';
import * as workflowController from '../controllers/workflow.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { authorize } from '../middleware/authorize.js';
import { requireFeature } from '../middleware/requireFeature.js';
import { validate, workflowSchemas } from '../validators/index.js';

const router = Router({ mergeParams: true });

router.use(authenticate, workspaceContext, requireFeature('workflows'));

router.get('/', workflowController.list);
router.post('/', validate({ body: workflowSchemas.create }), workflowController.create);
router.patch('/:id', validate({ body: workflowSchemas.update }), workflowController.update);
router.delete('/:id', authorize('ADMIN'), workflowController.remove);

export default router;
