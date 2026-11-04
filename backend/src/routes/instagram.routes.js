import { Router } from 'express';
import * as ctrl from '../controllers/instagram.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { authorize } from '../middleware/authorize.js';
import { requireFeature } from '../middleware/requireFeature.js';
import { validate, instagramSchemas } from '../validators/index.js';

const router = Router({ mergeParams: true });

// Same `automation` plan flag the rest of the Automation tab uses.
router.use(authenticate, workspaceContext, requireFeature('automation'));

router.get('/connection', ctrl.connection);
// Linking or unlinking the account is member-level work like the flows below.
router.post('/auth-url', authorize('CLIENT'), ctrl.authUrl);
// Finishes the OAuth round trip for the user who started it (see
// lib/oauthPending.js) — the public callback only parks the code.
router.post('/complete', authorize('CLIENT'), ctrl.completeConnection);
router.delete('/connection', authorize('CLIENT'), ctrl.disconnect);

router.get('/flows', ctrl.listFlows);
router.post('/flows', authorize('CLIENT'), validate({ body: instagramSchemas.create }), ctrl.createFlow);
router.patch('/flows/:id', authorize('CLIENT'), validate({ body: instagramSchemas.update }), ctrl.updateFlow);
router.delete('/flows/:id', authorize('CLIENT'), ctrl.deleteFlow);

export default router;
