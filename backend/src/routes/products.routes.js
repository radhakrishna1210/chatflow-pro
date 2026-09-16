import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { authorize } from '../middleware/authorize.js';
import { validate, productSchemas } from '../validators/index.js';
import * as productsController from '../controllers/products.controller.js';

const router = Router({ mergeParams: true });
router.use(authenticate, workspaceContext);

router.get('/', productsController.list);
router.get('/:id', productsController.get);
router.post('/', authorize('CLIENT'), validate({ body: productSchemas.create }), productsController.create);
router.patch('/:id', authorize('CLIENT'), validate({ body: productSchemas.update }), productsController.update);
router.delete('/:id', authorize('CLIENT'), productsController.remove);

export default router;
