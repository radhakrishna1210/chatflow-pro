import { Router } from 'express';
import * as apiKeysController from '../controllers/apikeys.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { validate, apiKeySchemas } from '../validators/index.js';

const router = Router({ mergeParams: true });

router.use(authenticate, workspaceContext);
router.get('/', apiKeysController.list);


// Authentication API key lifecycle.
// These routes use the workspace JWT authentication above.
// The raw secret is returned only when a new key is provisioned
// or explicitly rotated.

router.get(
  '/authentication',
  apiKeysController.getAuthentication
);

router.post(
  '/authentication/rotate',
  apiKeysController.rotateAuthentication
);

// Literal path before any ':id' route.

router.get('/scopes', apiKeysController.scopes);

// API Playground "Send Test Message". The page has always called this path,
// but it was never mounted, so the button answered 404. Sending goes through
// the guarded public-send path (see apikeys.service.js#sendTestMessage);
// VIEWER/AGENT are refused by the workspaceContext capability floor.
router.post('/test-message', apiKeysController.testMessage);

router.post(
  '/',
  validate({ body: apiKeySchemas.create }),
  apiKeysController.create
);

router.post('/:id/rotate', apiKeysController.rotate);

router.delete('/:id', apiKeysController.revoke);
export default router;
