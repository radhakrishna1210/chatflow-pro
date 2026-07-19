import { Router } from 'express';
import * as controller from '../controllers/integrations.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { authorize } from '../middleware/authorize.js';

// Workspace-scoped integration routes (mounted at /workspaces/:workspaceId/integrations).
// No blanket requireFeature() gate here — free integrations must stay usable
// on every plan, so pricing is enforced per-integration inside the
// connect/oauthStart controllers instead (see integrationCatalog.js).
const router = Router({ mergeParams: true });
router.use(authenticate, workspaceContext);

router.get('/', controller.list);
router.get('/oauth/providers', controller.oauthProviders);
router.post('/oauth/:provider/start', authorize('ADMIN'), controller.oauthStart);
router.post('/:provider', authorize('ADMIN'), controller.connect);
router.delete('/:provider', authorize('ADMIN'), controller.disconnect);

export default router;

// Public OAuth callback router (mounted at /integrations/oauth) — the provider
// redirects the user's browser here, so it cannot carry a Bearer token; the
// signed state performs the workspace binding instead.
export const oauthCallbackRouter = Router();
oauthCallbackRouter.get('/:provider/callback', controller.oauthCallback);
