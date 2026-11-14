import { Router } from 'express';
import * as ctrl from '../controllers/contextAgent.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { uploader, verifyFileContents, ACCEPTS } from '../lib/uploadGuard.js';

// Context agents: one chat assistant per dedicated WhatsApp number, answering
// from a context the workspace supplies. Same guards as /ai-agent — membership
// via workspaceContext, with viewers and inbox agents read-only by default
// (middleware/roleCapabilities.js).
const router = Router({ mergeParams: true });
router.use(authenticate, workspaceContext);

router.get('/', ctrl.list);
router.post('/', ctrl.create);
router.patch('/:agentId', ctrl.update);
router.delete('/:agentId', ctrl.remove);
// Parsed in memory; only the extracted text is stored.
router.post('/:agentId/context/upload',
  uploader(ACCEPTS.knowledge, 10 * 1024 * 1024).single('file'),
  verifyFileContents,
  ctrl.uploadContext);
router.post('/:agentId/test', ctrl.test);

export default router;
