import { Router } from 'express';
import * as ctrl from '../controllers/aiAgent.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
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
router.post('/deploy', ctrl.deploy);
router.post('/undeploy', ctrl.undeploy);
router.post('/test', ctrl.test);
router.patch('/intent-matching', ctrl.setIntent);

export default router;
