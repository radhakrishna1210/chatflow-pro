import { Router } from 'express';
import * as whatsappController from '../controllers/whatsapp.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { authorize } from '../middleware/authorize.js';

const router = Router({ mergeParams: true });

router.use(authenticate, workspaceContext);

router.get('/numbers', whatsappController.listNumbers);
router.post('/numbers/refresh', authorize('ADMIN'), whatsappController.refreshNumbers);
router.post('/numbers/connect-own', whatsappController.connectOwnNumber);
router.get('/numbers/pool', whatsappController.listPool);
router.post('/onboard', whatsappController.onboard);
router.delete('/numbers/:id', whatsappController.disconnect);

export default router;
