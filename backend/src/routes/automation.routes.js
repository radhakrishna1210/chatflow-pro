import { Router } from 'express';
import * as automationController from '../controllers/automation.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { authorize } from '../middleware/authorize.js';
import { requireFeature } from '../middleware/requireFeature.js';
import { validate, automationSchemas } from '../validators/index.js';

const router = Router({ mergeParams: true });

// Automation (triggers, basic auto-replies, voice) is a paid feature — gated
// by the plan's `automation` flag, mirroring how workflows/integrations gate
// their whole route surface. Editing the flag in the admin Plans tab takes
// effect immediately (hasFeature reads the plan live, no caching).
router.use(authenticate, workspaceContext, requireFeature('automation'));

router.get('/triggers', automationController.list);
router.post('/triggers', authorize('CLIENT'), validate({ body: automationSchemas.createTrigger }), automationController.create);
router.patch('/triggers/:id', authorize('CLIENT'), validate({ body: automationSchemas.updateTrigger }), automationController.update);
router.delete('/triggers/:id', authorize('CLIENT'), automationController.remove);

router.get('/basic', automationController.getBasicAutomations);
router.patch('/basic', authorize('CLIENT'), automationController.updateBasicAutomations);
router.post('/workflows/ai-preview', authorize('CLIENT'), automationController.generateWorkflowPreview);
router.get('/voice', automationController.getVoiceSettings);
router.patch('/voice', authorize('CLIENT'), automationController.updateVoiceSettings);


export default router;
