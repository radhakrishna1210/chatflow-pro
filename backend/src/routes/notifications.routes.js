import { Router } from 'express';
import * as notificationsController from '../controllers/notifications.controller.js';
import { authenticate } from '../middleware/authenticate.js';

// Mounted at /notifications (not under /workspaces/:id) because a
// notification can be addressed to a person rather than a workspace — an
// invitation is the obvious case: you get it before you are a member of the
// workspace that sent it, so workspaceContext could never run.
const router = Router();

router.use(authenticate);

router.get('/', notificationsController.list);
router.get('/unread-count', notificationsController.unreadCount);
router.post('/read-all', notificationsController.markAllRead);
router.post('/:id/read', notificationsController.markRead);

export default router;
