import { Router } from 'express';
import * as campaignsController from '../controllers/campaigns.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { authorize } from '../middleware/authorize.js';
import { validate, campaignSchemas } from '../validators/index.js';

const router = Router({ mergeParams: true });

router.use(authenticate, workspaceContext);

// Building and sending campaigns is core workspace work, not administration:
// a member who can add contacts can also campaign to them. Admin-only
// creation left members on a Free plan able to import contacts and then do
// nothing with them. Spend stays bounded — every launch is priced against the
// shared wallet and refused when the balance won't cover it.
router.get('/', campaignsController.list);
router.get('/fallback-capabilities', campaignsController.fallbackCapabilities);
router.post('/', authorize('CLIENT'), validate({ body: campaignSchemas.create }), campaignsController.create);
router.post('/estimate', authorize('CLIENT'), validate({ body: campaignSchemas.estimate }), campaignsController.estimate);
router.get('/:id', campaignsController.getOne);
router.patch('/:id', authorize('CLIENT'), validate({ body: campaignSchemas.update }), campaignsController.update);
router.put('/:id', authorize('CLIENT'), validate({ body: campaignSchemas.update }), campaignsController.update);
router.post('/:id/recipients', authorize('CLIENT'), validate({ body: campaignSchemas.addRecipients }), campaignsController.addRecipients);
// PUT replaces the audience (draft editing); POST above only adds to it.
router.put('/:id/recipients', authorize('CLIENT'), validate({ body: campaignSchemas.setRecipients }), campaignsController.setRecipients);
router.post('/:id/launch', authorize('CLIENT'), validate({ body: campaignSchemas.launch }), campaignsController.launch);
router.patch('/:id/cancel', authorize('CLIENT'), campaignsController.cancel);

export default router;
