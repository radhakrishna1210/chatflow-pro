import { Router } from 'express';
import * as workflowController from '../controllers/workflow.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { requireFeature } from '../middleware/requireFeature.js';
import { authorize } from '../middleware/authorize.js';
import { validate, workflowSchemas } from '../validators/index.js';

const router = Router({ mergeParams: true });

router.use(authenticate, workspaceContext, requireFeature('workflows'));

router.get('/', workflowController.list);
router.get('/runs', workflowController.runs);
// Workflows message customers on their own, so building them is not an
// agent's or viewer's call.
router.post('/', authorize('CLIENT'), validate({ body: workflowSchemas.create }), workflowController.create);
router.patch('/:id', authorize('CLIENT'), validate({ body: workflowSchemas.update }), workflowController.update);
router.delete('/:id', authorize('CLIENT'), workflowController.remove);

export default router;
