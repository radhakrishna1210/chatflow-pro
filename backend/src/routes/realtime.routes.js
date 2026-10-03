import { Router } from 'express';
import * as realtimeController from '../controllers/realtime.controller.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { authenticateSessionOrStream } from '../services/realtime.service.js';

// Live updates for the inbox, campaign and template screens
// (services/realtime.service.js). The token is fetched with the normal Bearer
// session; the stream itself is opened with that token, since EventSource
// cannot send headers — authenticateSessionOrStream picks which one a path
// takes, and nothing else accepts a stream token. workspaceContext then runs
// for both, so membership, suspension, the inactive-subscription block and the
// role floor apply as everywhere else.
const router = Router({ mergeParams: true });

router.use(authenticateSessionOrStream, workspaceContext);

router.get('/token', realtimeController.token);
router.get('/stream', realtimeController.stream);

export default router;
