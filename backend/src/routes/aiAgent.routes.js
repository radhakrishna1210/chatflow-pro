import { Router } from 'express';
import * as ctrl from '../controllers/aiAgent.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { authorize } from '../middleware/authorize.js';

const router = Router({ mergeParams: true });
router.use(authenticate, workspaceContext);

router.get('/config', ctrl.getConfig);
// Deployed agents a campaign can be pointed at, and the campaigns already
// using one. Readable by any member — the campaign wizard needs both.
router.get('/agents', ctrl.agents);
router.get('/campaigns', ctrl.campaignUsage);
router.patch('/config', authorize('ADMIN'), ctrl.updateConfig);
router.post('/deploy', authorize('ADMIN'), ctrl.deploy);
router.post('/undeploy', authorize('ADMIN'), ctrl.undeploy);
router.post('/test', ctrl.test);
router.patch('/intent-matching', authorize('ADMIN'), ctrl.setIntent);

export default router;
