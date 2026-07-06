import { Router } from 'express';
import * as securityController from '../controllers/security.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';

const router = Router({ mergeParams: true });

router.use(authenticate, workspaceContext);

router.get('/sessions', securityController.getSessions);
router.delete('/sessions/:id', securityController.revokeSession);
router.post('/change-password', securityController.changePassword);
router.get('/2fa', securityController.get2FA);
router.post('/2fa', securityController.toggle2FA);

export default router;
