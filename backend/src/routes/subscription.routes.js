import { Router } from 'express';
import { z } from 'zod';
import * as controller from '../controllers/subscription.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../validators/index.js';

// Exactly one change per request: a scheduled plan (null clears it) or the
// cancel-at-period-end flag.
const updateSubscriptionSchema = z.union([
  z.object({ planId: z.string().trim().min(1).max(64).nullable() }).strict(),
  z.object({ cancelAtPeriodEnd: z.boolean() }).strict(),
]);

const optionalText = (max) => z.string().trim().max(max).optional();
const billingProfileSchema = z.object({
  businessName: optionalText(200),
  email: z.string().trim().email('Enter a valid billing email').max(200).optional().or(z.literal('')),
  address: optionalText(1000),
  taxId: optionalText(64),
}).strict();

const router = Router({ mergeParams: true });
router.use(authenticate, workspaceContext);

router.get('/', controller.getSummary);
router.get('/plans', controller.getPlans);
router.get('/pricing', controller.getMessagePricing);
// Changing/buying a plan is ADMIN-only (README §12.2 role table), same
// restriction already used for wallet recharge.
router.post('/checkout', authorize('ADMIN'), controller.createCheckout);
router.post('/checkout/verify', authorize('ADMIN'), controller.verifyCheckout);
// Downgrade / cancel at period end (no proration), and renew-from-wallet.
router.patch('/', authorize('ADMIN'), validate({ body: updateSubscriptionSchema }), controller.updateSubscription);
router.post('/renew', authorize('ADMIN'), controller.renewNow);
// Business details for invoices (name, email, address, GSTIN).
router.get('/billing-profile', controller.getBillingProfile);
router.put('/billing-profile', authorize('ADMIN'), validate({ body: billingProfileSchema }), controller.saveBillingProfile);

// Add-ons. Reading the catalogue is open to any member (the Payments screen
// shows it); buying, cancelling and auto-renew change what the workspace pays, so they sit
// behind the same ADMIN gate as plan checkout and wallet recharge.
router.get('/addons', controller.listAddons);
router.post('/addons/checkout', authorize('ADMIN'), controller.createAddonCheckout);
router.post('/addons/checkout/verify', authorize('ADMIN'), controller.verifyAddonCheckout);
router.delete('/addons/:addonKey', authorize('ADMIN'), controller.cancelAddon);
// Opt in/out of renewing this add-on's packs from the wallet at period end.
router.patch('/addons/:addonKey/auto-renew', authorize('ADMIN'), controller.setAddonAutoRenew);

export default router;
