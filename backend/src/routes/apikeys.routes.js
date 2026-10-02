import { Router } from 'express';
import * as apiKeysController from '../controllers/apikeys.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { authorize } from '../middleware/authorize.js';
import { validate, apiKeySchemas } from '../validators/index.js';

const router = Router({ mergeParams: true });

router.use(authenticate, workspaceContext);

// The scope catalogue is not sensitive; the key-creation UI renders from it.
// Literal paths come before any ':id' route.
router.get('/scopes', apiKeysController.scopes);

// The API playground's test send. It is an ordinary metered send, so it needs
// the same role as sending from the dashboard, not key management.
router.post(
  '/test-message',
  authorize('CLIENT'),
  validate({ body: apiKeySchemas.testMessage }),
  apiKeysController.testMessage
);

// An API key is a long-lived credential that can send paid messages and
// rewrite the webhook URL, so listing, creating, rotating and revoking keys is
// admin-only.
router.use(authorize('ADMIN'));

router.get('/', apiKeysController.list);

// Authentication API key lifecycle. Reading never provisions: the raw secret
// is returned only by an explicit POST that creates the key, or a rotation.
router.get('/authentication', apiKeysController.getAuthentication);
router.post('/authentication', apiKeysController.provisionAuthentication);
router.post('/authentication/rotate', apiKeysController.rotateAuthentication);

router.post(
  '/',
  validate({ body: apiKeySchemas.create }),
  apiKeysController.create
);

router.post('/:id/rotate', apiKeysController.rotate);

router.delete('/:id', apiKeysController.revoke);

export default router;
