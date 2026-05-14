import { Router } from 'express';
import * as conversationsController from '../controllers/conversations.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';

const router = Router({ mergeParams: true });

router.use(authenticate, workspaceContext);

router.get('/', conversationsController.list);
router.get('/:id/messages', conversationsController.getMessages);
router.post('/:id/messages', conversationsController.sendMessage);

export default router;
