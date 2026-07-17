import { Router } from 'express';
import * as controller from '../controllers/subscription.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { authorize } from '../middleware/authorize.js';

const router = Router({ mergeParams: true });
router.use(authenticate, workspaceContext);

router.get('/', controller.getSummary);
router.get('/plans', controller.getPlans);
// Changing/buying a plan is ADMIN-only (README §12.2 role table), same
// restriction already used for wallet recharge.
router.post('/checkout', authorize('ADMIN'), controller.createCheckout);
router.post('/checkout/verify', authorize('ADMIN'), controller.verifyCheckout);

export default router;
