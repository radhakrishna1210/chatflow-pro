import { Router } from 'express';
import * as campaignsController from '../controllers/campaigns.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { authorize } from '../middleware/authorize.js';
import { validate, campaignSchemas } from '../validators/index.js';

const router = Router({ mergeParams: true });

router.use(authenticate, workspaceContext);

router.get('/', campaignsController.list);
router.post('/', authorize('ADMIN'), validate({ body: campaignSchemas.create }), campaignsController.create);
router.get('/:id', campaignsController.getOne);
router.post('/:id/recipients', authorize('ADMIN'), validate({ body: campaignSchemas.addRecipients }), campaignsController.addRecipients);
router.post('/:id/launch', authorize('ADMIN'), validate({ body: campaignSchemas.launch }), campaignsController.launch);
router.patch('/:id/cancel', authorize('ADMIN'), campaignsController.cancel);

export default router;
