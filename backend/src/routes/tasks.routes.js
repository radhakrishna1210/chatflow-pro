import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { authorize } from '../middleware/authorize.js';
import { validate, taskSchemas } from '../validators/index.js';
import * as tasksController from '../controllers/tasks.controller.js';

const router = Router({ mergeParams: true });

router.use(authenticate, workspaceContext);

router.get('/', tasksController.list);
router.post('/', authorize('CLIENT'), validate({ body: taskSchemas.create }), tasksController.create);
router.get('/:id', tasksController.get);
router.patch('/:id', authorize('CLIENT'), validate({ body: taskSchemas.update }), tasksController.update);
router.delete('/:id', authorize('CLIENT'), tasksController.remove);

export default router;
