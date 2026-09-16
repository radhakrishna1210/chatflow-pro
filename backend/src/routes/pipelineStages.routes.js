import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { authorize } from '../middleware/authorize.js';
import { validate, pipelineStageSchemas } from '../validators/index.js';
import * as stagesController from '../controllers/pipelineStages.controller.js';

const router = Router({ mergeParams: true });

router.use(authenticate, workspaceContext);

router.get('/', stagesController.list);
// Reordering and reweighting the pipeline changes what every member sees and
// what the forecast reports, so it is an admin action.
router.patch('/reorder', authorize('ADMIN'), validate({ body: pipelineStageSchemas.reorder }), stagesController.reorder);
router.patch('/:key', authorize('ADMIN'), validate({ body: pipelineStageSchemas.update }), stagesController.update);

export default router;
