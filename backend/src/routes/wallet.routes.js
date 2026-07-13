import { Router } from 'express';
import * as walletController from '../controllers/wallet.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { authorize } from '../middleware/authorize.js';

const router = Router({ mergeParams: true });
router.use(authenticate, workspaceContext);

router.get('/', walletController.getWallet);
router.post('/recharge', authorize('ADMIN'), walletController.recharge);

export default router;
