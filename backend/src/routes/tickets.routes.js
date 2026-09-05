import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { authorize } from '../middleware/authorize.js';
import { validate, ticketSchemas } from '../validators/index.js';
import * as ticketsController from '../controllers/tickets.controller.js';

const router = Router({ mergeParams: true });
router.use(authenticate, workspaceContext);

// `/counts` before `/:id`, or "counts" is matched as a ticket id.
router.get('/', ticketsController.list);
router.get('/counts', ticketsController.counts);
router.get('/:id', ticketsController.get);
router.post('/', authorize('CLIENT'), validate({ body: ticketSchemas.create }), ticketsController.create);
router.patch('/:id', authorize('CLIENT'), validate({ body: ticketSchemas.update }), ticketsController.update);
router.patch('/:id/status', authorize('CLIENT'), validate({ body: ticketSchemas.status }), ticketsController.changeStatus);
router.delete('/:id', authorize('CLIENT'), ticketsController.remove);

export default router;
