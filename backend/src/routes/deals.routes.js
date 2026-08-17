import { Router } from 'express';
import * as dealsController from '../controllers/deals.controller.js';
import * as dealLineItemsController from '../controllers/dealLineItems.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { authorize } from '../middleware/authorize.js';
import { validate, dealSchemas } from '../validators/index.js';

const router = Router({ mergeParams: true });

router.use(authenticate, workspaceContext);

router.get('/', dealsController.list);
router.post('/', authorize('CLIENT'), validate({ body: dealSchemas.create }), dealsController.create);
router.get('/:id', dealsController.get);
router.patch('/:id', authorize('CLIENT'), validate({ body: dealSchemas.update }), dealsController.update);
router.patch('/:id/stage', authorize('CLIENT'), validate({ body: dealSchemas.stageUpdate }), dealsController.updateStage);
router.delete('/:id', authorize('CLIENT'), dealsController.remove);

// Line items live under their deal. Every money field on them is calculated
// server-side — see services/lineItems.js.
router.get('/:id/line-items', dealLineItemsController.list);
router.post('/:id/line-items', authorize('CLIENT'), validate({ body: dealSchemas.lineItem }), dealLineItemsController.create);
router.patch('/:id/line-items/:lineId', authorize('CLIENT'), validate({ body: dealSchemas.lineItemUpdate }), dealLineItemsController.update);
router.delete('/:id/line-items/:lineId', authorize('CLIENT'), dealLineItemsController.remove);

export default router;
