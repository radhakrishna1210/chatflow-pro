import { Router } from 'express';
import * as optOutController from '../controllers/optout.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { validate, optOutSchemas } from '../validators/index.js';
import { authorize } from '../middleware/authorize.js';

const router = Router({ mergeParams: true });

router.use(authenticate, workspaceContext);

// Everyone in the workspace can see who is blocked (it explains why a
// campaign skipped someone). Agents may block a number that asks to be left
// alone (roleCapabilities), but unblocking — messaging someone again who sent
// STOP — is a compliance decision, so it needs a Member or Admin.
router.get('/', optOutController.list);
router.get('/keywords', optOutController.keywords);
router.get('/export', optOutController.exportCsv);
router.post('/', validate({ body: optOutSchemas.block }), optOutController.block);
router.post('/unblock', authorize('CLIENT'), validate({ body: optOutSchemas.bulkUnblock }), optOutController.unblock);
router.delete('/:id', authorize('CLIENT'), optOutController.unblock);

export default router;
