import { Router } from 'express';
import * as realtimeController from '../controllers/realtime.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { authenticateStreamToken } from '../services/realtime.service.js';

// Live updates for the inbox, campaign and template screens
// (services/realtime.service.js). The token is fetched with the normal Bearer
// session; the stream itself is opened with that token, since EventSource
// cannot send headers. Both run workspaceContext, so membership, suspension,
// the inactive-subscription block and the role floor apply as everywhere else.
const router = Router({ mergeParams: true });

router.get('/token', authenticate, workspaceContext, realtimeController.token);
router.get('/stream', authenticateStreamToken, workspaceContext, realtimeController.stream);

export default router;
