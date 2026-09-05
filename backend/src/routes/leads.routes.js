import { Router } from 'express';
import * as leadsController from '../controllers/leads.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { authorize } from '../middleware/authorize.js';
import { validate, leadSchemas } from '../validators/index.js';

const router = Router({ mergeParams: true });

router.use(authenticate, workspaceContext);

router.get('/', leadsController.list);
router.post('/', authorize('CLIENT'), validate({ body: leadSchemas.create }), leadsController.create);
router.get('/:id', leadsController.get);
router.patch('/:id', authorize('CLIENT'), validate({ body: leadSchemas.update }), leadsController.update);
router.delete('/:id', authorize('CLIENT'), leadsController.remove);
router.post('/:id/recalculate-score', authorize('CLIENT'), leadsController.recalculateScore);
router.post('/:id/convert', authorize('CLIENT'), validate({ body: leadSchemas.convert }), leadsController.convert);

export default router;
