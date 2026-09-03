import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { authorize } from '../middleware/authorize.js';
import { validate, savedViewSchemas } from '../validators/index.js';
import * as savedViewsController from '../controllers/savedViews.controller.js';

const router = Router({ mergeParams: true });

router.use(authenticate, workspaceContext);

router.get('/', savedViewsController.list);
router.post('/', authorize('CLIENT'), validate({ body: savedViewSchemas.create }), savedViewsController.create);
router.patch('/:id', authorize('CLIENT'), validate({ body: savedViewSchemas.update }), savedViewsController.update);
router.delete('/:id', authorize('CLIENT'), savedViewsController.remove);

export default router;
