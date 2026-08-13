// Intent routing rules — the layer in front of the AI agent.
import { Router } from 'express';
import * as intentController from '../controllers/intent.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { authorize } from '../middleware/authorize.js';

const router = Router({ mergeParams: true });

router.use(authenticate, workspaceContext);

// Reading and testing are day-to-day work for anyone in the workspace; writing
// a routing rule changes what every customer's message does, so it matches the
// same CLIENT bar the automation triggers already use.
router.get('/', intentController.list);
router.get('/accuracy', intentController.accuracy);
router.post('/test', intentController.test);

router.post('/', authorize('CLIENT'), intentController.create);
router.patch('/:id', authorize('CLIENT'), intentController.update);
router.delete('/:id', authorize('CLIENT'), intentController.remove);

export default router;
