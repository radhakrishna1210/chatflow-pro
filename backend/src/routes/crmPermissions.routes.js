import { Router } from 'express';
import * as crmPermissionsController from '../controllers/crmPermissions.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';

const router = Router({ mergeParams: true });

router.use(authenticate, workspaceContext);

router.get('/my', crmPermissionsController.getMyCrmPermissions);

export default router;
