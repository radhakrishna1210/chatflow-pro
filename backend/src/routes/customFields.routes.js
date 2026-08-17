import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { authorize } from '../middleware/authorize.js';
import { validate, customFieldSchemas } from '../validators/index.js';
import * as cfController from '../controllers/customFields.controller.js';

const router = Router({ mergeParams: true });
router.use(authenticate, workspaceContext);

// Everyone needs to read the definitions to render a record form; only an
// admin changes the shape of the workspace's data.
router.get('/', cfController.list);
router.post('/', authorize('ADMIN'), validate({ body: customFieldSchemas.create }), cfController.create);
router.patch('/:id', authorize('ADMIN'), validate({ body: customFieldSchemas.update }), cfController.update);
router.delete('/:id', authorize('ADMIN'), cfController.remove);

export default router;
