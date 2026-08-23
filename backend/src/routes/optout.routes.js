import { Router } from 'express';
import * as optOutController from '../controllers/optout.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { validate, optOutSchemas } from '../validators/index.js';

const router = Router({ mergeParams: true });

router.use(authenticate, workspaceContext);

// Everyone in the workspace can see who is blocked (it explains why a
// campaign skipped someone); only admins can change the list.
router.get('/', optOutController.list);
router.get('/keywords', optOutController.keywords);
router.get('/export', optOutController.exportCsv);
router.post('/', validate({ body: optOutSchemas.block }), optOutController.block);
router.post('/unblock', validate({ body: optOutSchemas.bulkUnblock }), optOutController.unblock);
router.delete('/:id', optOutController.unblock);

export default router;
