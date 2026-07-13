import { Router } from 'express';
import * as analyticsController from '../controllers/analytics.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';

const router = Router({ mergeParams: true });

router.use(authenticate, workspaceContext);

router.get('/overview', analyticsController.overview);
router.get('/delivery', analyticsController.delivery);
router.get('/campaigns', analyticsController.campaigns);
router.get('/agents', analyticsController.agents);
router.get('/chat', analyticsController.getChatAnalytics);

export default router;
