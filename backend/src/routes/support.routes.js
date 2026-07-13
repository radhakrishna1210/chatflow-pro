import { Router } from 'express';
import * as controller from '../controllers/support.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';

const router = Router({ mergeParams: true });
router.use(authenticate, workspaceContext);

router.get('/', controller.list);
router.post('/', controller.create);

export default router;
