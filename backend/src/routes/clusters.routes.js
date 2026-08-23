import { Router } from 'express';
import * as clustersController from '../controllers/clusters.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { validate, clusterSchemas } from '../validators/index.js';

const router = Router({ mergeParams: true });

router.use(authenticate, workspaceContext);

router.get('/', clustersController.list);
router.post('/', validate({ body: clusterSchemas.create }), clustersController.create);
router.get('/:clusterId', clustersController.get);
router.put('/:clusterId', validate({ body: clusterSchemas.update }), clustersController.update);
router.patch('/:clusterId', validate({ body: clusterSchemas.update }), clustersController.update);
router.delete('/:clusterId', clustersController.remove);

export default router;
