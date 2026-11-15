import { Router } from 'express';
import { createTemplate, createCampaign, updateCampaign, updateTemplate, executeWorkflow } from '../controllers/ai.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { workspaceAiModelContext } from '../middleware/workspaceContext.js';

const router = Router();

// workspaceAiModelContext: these run under the caller's workspace AI model.
router.use(authenticate, workspaceAiModelContext);

// Not workspace-scoped routers, so the VIEWER/AGENT write floor applied by
// workspaceContext never ran here: a read-only Viewer could create templates
// and campaigns and cancel campaigns. Writes are member-level work, as on the
// workspace-scoped template and campaign routes.
router.post('/template/create', authorize('CLIENT'), createTemplate);
router.post('/campaign/create', authorize('CLIENT'), createCampaign);
router.post('/campaign/update', authorize('CLIENT'), updateCampaign);
router.post('/template/update', authorize('CLIENT'), updateTemplate);
router.post('/workflow/execute', executeWorkflow);

export default router;
