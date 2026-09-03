import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { authorize } from '../middleware/authorize.js';
import { validate, crmActivitySchemas } from '../validators/index.js';
import * as activitiesController from '../controllers/activities.controller.js';

const router = Router({ mergeParams: true });

router.use(authenticate, workspaceContext);

router.get('/', activitiesController.list);
router.post('/', authorize('CLIENT'), validate({ body: crmActivitySchemas.create }), activitiesController.create);
router.delete('/:id', authorize('CLIENT'), activitiesController.remove);

export default router;
