import { Router } from 'express';
import * as settingsController from '../controllers/settings.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { authorize } from '../middleware/authorize.js';

const router = Router({ mergeParams: true });

router.use(authenticate, workspaceContext);

router.get('/', settingsController.getSettings);
router.patch('/', authorize('ADMIN'), settingsController.updateSettings);
router.get('/invoices', settingsController.getInvoices);

router.get('/billing', settingsController.getBilling);
router.patch('/billing', authorize('ADMIN'), settingsController.updateBilling);

router.get('/wallet', settingsController.getWallet);
router.post('/recharge', authorize('ADMIN'), settingsController.rechargeWallet);

router.get('/subscription', settingsController.getSubscription);
router.post('/subscription/addons', authorize('ADMIN'), settingsController.updateAddons);

export default router;
