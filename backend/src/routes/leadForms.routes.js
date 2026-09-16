import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { authorize } from '../middleware/authorize.js';
import { validate, leadFormSchemas } from '../validators/index.js';
import * as formsController from '../controllers/leadForms.controller.js';

const router = Router({ mergeParams: true });
router.use(authenticate, workspaceContext);

router.get('/', formsController.list);
router.get('/:id', formsController.get);
router.post('/', authorize('CLIENT'), validate({ body: leadFormSchemas.create }), formsController.create);
router.patch('/:id', authorize('CLIENT'), validate({ body: leadFormSchemas.update }), formsController.update);
router.delete('/:id', authorize('CLIENT'), formsController.remove);

export default router;
