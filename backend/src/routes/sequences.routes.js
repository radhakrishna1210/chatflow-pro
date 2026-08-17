import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { authorize } from '../middleware/authorize.js';
import { validate, sequenceSchemas } from '../validators/index.js';
import * as sequencesController from '../controllers/sequences.controller.js';

const router = Router({ mergeParams: true });
router.use(authenticate, workspaceContext);

router.get('/', sequencesController.list);
router.get('/:id', sequencesController.get);
router.post('/', authorize('CLIENT'), validate({ body: sequenceSchemas.create }), sequencesController.create);
router.patch('/:id', authorize('CLIENT'), validate({ body: sequenceSchemas.update }), sequencesController.update);
router.patch('/:id/status', authorize('CLIENT'), validate({ body: sequenceSchemas.status }), sequencesController.changeStatus);
router.delete('/:id', authorize('CLIENT'), sequencesController.remove);
router.post('/:id/enroll', authorize('CLIENT'), validate({ body: sequenceSchemas.enroll }), sequencesController.enroll);
router.delete('/:id/enrollments/:enrollmentId', authorize('CLIENT'), sequencesController.unenroll);

export default router;
