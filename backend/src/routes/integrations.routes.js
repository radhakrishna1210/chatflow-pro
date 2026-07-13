import { Router } from 'express';
import * as controller from '../controllers/integrations.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { authorize } from '../middleware/authorize.js';

const router = Router({ mergeParams: true });
router.use(authenticate, workspaceContext);

router.get('/', controller.list);
router.post('/:provider', authorize('ADMIN'), controller.connect);
router.delete('/:provider', authorize('ADMIN'), controller.disconnect);

export default router;
