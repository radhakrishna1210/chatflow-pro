import { Router } from 'express';
import * as membersController from '../controllers/members.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { authorize } from '../middleware/authorize.js';
import { validate, memberSchemas } from '../validators/index.js';

const router = Router({ mergeParams: true });

router.use(authenticate, workspaceContext);

router.get('/', membersController.list);
router.post('/invite', authorize('ADMIN'), validate({ body: memberSchemas.invite }), membersController.invite);
router.patch('/:userId', authorize('ADMIN'), validate({ body: memberSchemas.updateRole }), membersController.updateRole);
router.delete('/:userId', authorize('ADMIN'), membersController.remove);

export default router;
