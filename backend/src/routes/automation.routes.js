import { Router } from 'express';
import * as automationController from '../controllers/automation.controller.js';
import * as voiceController from '../controllers/voice.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { authorize } from '../middleware/authorize.js';
import { requireFeature } from '../middleware/requireFeature.js';
import { rateLimit } from '../middleware/rateLimit.js';
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
router.patch('/basic', authorize('CLIENT'), validate({ body: automationSchemas.updateBasic }), automationController.updateBasicAutomations);
// Each call is a model generation, and a bare URL is a crawl of up to six
// pages of someone else's site from our servers — limited like the other AI
// endpoints so a script cannot spend the quota or use us to hammer a host.
router.post('/workflows/ai-preview', authorize('CLIENT'), rateLimit({ windowMs: 60_000, max: 10, keyPrefix: 'wf-ai-preview' }), automationController.generateWorkflowPreview);
router.get('/voice', automationController.getVoiceSettings);
router.patch('/voice', authorize('CLIENT'), validate({ body: automationSchemas.updateVoice }), automationController.updateVoiceSettings);
router.get('/voice/calls', voiceController.listCalls);


export default router;
