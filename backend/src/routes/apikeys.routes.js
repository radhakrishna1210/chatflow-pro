import { Router } from 'express';
import * as apiKeysController from '../controllers/apikeys.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { validate, apiKeySchemas } from '../validators/index.js';

const router = Router({ mergeParams: true });

router.use(authenticate, workspaceContext);

router.get('/', apiKeysController.list);
// Literal path before any ':id' route.
router.get('/scopes', apiKeysController.scopes);
router.post('/', validate({ body: apiKeySchemas.create }), apiKeysController.create);
router.post('/:id/rotate', apiKeysController.rotate);
router.delete('/:id', apiKeysController.revoke);
router.post('/test-message', validate({ body: apiKeySchemas.testMessage }), apiKeysController.testMessage);

export default router;
