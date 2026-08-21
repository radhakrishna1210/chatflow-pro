import { Router } from 'express';
import * as controller from '../controllers/subscription.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { authorize } from '../middleware/authorize.js';

const router = Router({ mergeParams: true });
router.use(authenticate, workspaceContext);

router.get('/', controller.getSummary);
router.get('/plans', controller.getPlans);
router.get('/pricing', controller.getMessagePricing);
// Changing/buying a plan is ADMIN-only (README §12.2 role table), same
// restriction already used for wallet recharge.
router.post('/checkout', authorize('ADMIN'), controller.createCheckout);
router.post('/checkout/verify', authorize('ADMIN'), controller.verifyCheckout);

// Add-ons. Reading the catalogue is open to any member (the Payments screen
// shows it); buying and cancelling change what the workspace pays, so they sit
// behind the same ADMIN gate as plan checkout and wallet recharge.
router.get('/addons', controller.listAddons);
router.post('/addons/checkout', authorize('ADMIN'), controller.createAddonCheckout);
router.post('/addons/checkout/verify', authorize('ADMIN'), controller.verifyAddonCheckout);
router.delete('/addons/:addonKey', authorize('ADMIN'), controller.cancelAddon);

export default router;
