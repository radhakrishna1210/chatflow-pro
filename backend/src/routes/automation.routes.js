import { Router } from 'express';
import * as automationController from '../controllers/automation.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { authorize } from '../middleware/authorize.js';

const router = Router({ mergeParams: true });

router.use(authenticate, workspaceContext);

router.get('/triggers', automationController.list);
router.post('/triggers', authorize('ADMIN'), automationController.create);
router.patch('/triggers/:id', authorize('ADMIN'), automationController.update);
router.delete('/triggers/:id', authorize('ADMIN'), automationController.remove);

router.get('/basic', automationController.getBasicAutomations);
router.patch('/basic', authorize('ADMIN'), automationController.updateBasicAutomations);
router.post('/workflows/ai-preview', authorize('ADMIN', 'CLIENT'), automationController.generateWorkflowPreview);
router.get('/voice', automationController.getVoiceSettings);
router.patch('/voice', authorize('ADMIN'), automationController.updateVoiceSettings);


export default router;
