import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { authorize } from '../middleware/authorize.js';
import { validate, quoteSchemas } from '../validators/index.js';
import * as quotesController from '../controllers/quotes.controller.js';

const router = Router({ mergeParams: true });
router.use(authenticate, workspaceContext);

router.get('/', quotesController.list);
router.get('/:id', quotesController.get);
router.post('/', authorize('CLIENT'), validate({ body: quoteSchemas.create }), quotesController.create);
router.patch('/:id', authorize('CLIENT'), validate({ body: quoteSchemas.update }), quotesController.update);
router.patch('/:id/status', authorize('CLIENT'), validate({ body: quoteSchemas.status }), quotesController.changeStatus);
router.delete('/:id', authorize('CLIENT'), quotesController.remove);
router.post('/:id/line-items', authorize('CLIENT'), validate({ body: quoteSchemas.lineItem }), quotesController.addLine);
router.delete('/:id/line-items/:lineId', authorize('CLIENT'), quotesController.removeLine);

export default router;
