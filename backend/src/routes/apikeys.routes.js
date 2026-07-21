import { Router } from 'express';
import * as apiKeysController from '../controllers/apikeys.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { authorize } from '../middleware/authorize.js';
import { validate, apiKeySchemas } from '../validators/index.js';

const router = Router({ mergeParams: true });

router.use(authenticate, workspaceContext);

router.get('/', apiKeysController.list);
router.post('/', authorize('ADMIN'), validate({ body: apiKeySchemas.create }), apiKeysController.create);
router.post('/:id/rotate', authorize('ADMIN'), apiKeysController.rotate);
router.delete('/:id', authorize('ADMIN'), apiKeysController.revoke);

export default router;
