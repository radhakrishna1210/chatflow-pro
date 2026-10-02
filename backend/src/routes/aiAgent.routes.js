import { Router } from 'express';
import * as ctrl from '../controllers/aiAgent.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { requireFeature } from '../middleware/requireFeature.js';
import { uploader, verifyFileContents, ACCEPTS } from '../lib/uploadGuard.js';

const router = Router({ mergeParams: true });
router.use(authenticate, workspaceContext);

router.get('/config', ctrl.getConfig);
// Deployed agents a campaign can be pointed at, and the campaigns already
// using one. Readable by any member — the campaign wizard needs both.
router.get('/agents', ctrl.agents);
router.get('/campaigns', ctrl.campaignUsage);
router.patch('/config', ctrl.updateConfig);
// Parsed in memory; only the extracted text is stored.
router.post('/knowledge/upload',
  uploader(ACCEPTS.knowledge, 10 * 1024 * 1024).single('file'),
  verifyFileContents,
  ctrl.uploadKnowledge);
// Running the agent (and intent matching) is a paid-plan feature: these are
// the calls that start spending model tokens. Configuring and undeploying stay
// open so onboarding works and a downgraded workspace can switch it off.
router.post('/deploy', requireFeature('campaignAi'), ctrl.deploy);
router.post('/undeploy', ctrl.undeploy);
router.post('/test', requireFeature('campaignAi'), ctrl.test);
router.patch('/intent-matching', requireFeature('campaignAi'), ctrl.setIntent);

export default router;
