import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import * as forecastController from '../controllers/forecast.controller.js';

const router = Router({ mergeParams: true });

router.use(authenticate, workspaceContext);

router.get('/', forecastController.get);

export default router;
