import { Router } from 'express';
import * as campaignsController from '../controllers/campaigns.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { authorize } from '../middleware/authorize.js';

const router = Router({ mergeParams: true });

router.use(authenticate, workspaceContext);

router.get('/', campaignsController.list);
router.post('/', authorize('CLIENT'), campaignsController.create);
router.get('/:id', campaignsController.getOne);
router.post('/:id/recipients', authorize('CLIENT'), campaignsController.addRecipients);
router.post('/:id/launch', authorize('CLIENT'), campaignsController.launch);
router.patch('/:id/cancel', authorize('CLIENT'), campaignsController.cancel);

export default router;
