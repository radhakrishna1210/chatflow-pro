// Intent routing rules — the layer in front of the AI agent.
import { Router } from 'express';
import * as intentController from '../controllers/intent.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { authorize } from '../middleware/authorize.js';
import { requireFeature } from '../middleware/requireFeature.js';

const router = Router({ mergeParams: true });

router.use(authenticate, workspaceContext);

// Reading and testing are day-to-day work for anyone in the workspace; writing
// a routing rule changes what every customer's message does, so it matches the
// same CLIENT bar the automation triggers already use.
router.get('/', intentController.list);
router.get('/accuracy', intentController.accuracy);
router.post('/test', intentController.test);

// Intent matching is the campaignAi plan feature: creating and editing rules
// need it. Reading and deleting stay open so a downgraded workspace can clean up.
router.post('/', authorize('CLIENT'), requireFeature('campaignAi'), intentController.create);
router.patch('/:id', authorize('CLIENT'), requireFeature('campaignAi'), intentController.update);
router.delete('/:id', authorize('CLIENT'), intentController.remove);

export default router;
