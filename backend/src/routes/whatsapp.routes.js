import { Router } from 'express';
import * as whatsappController from '../controllers/whatsapp.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { authorize } from '../middleware/authorize.js';

const router = Router({ mergeParams: true });

router.use(authenticate, workspaceContext);

router.get('/numbers', whatsappController.listNumbers);
router.post('/numbers/refresh', authorize('ADMIN'), whatsappController.refreshNumbers);
router.post('/numbers/connect-own', authorize('ADMIN'), whatsappController.connectOwnNumber);
router.get('/numbers/pool', whatsappController.listPool);
router.post('/onboard', authorize('ADMIN'), whatsappController.onboard);
router.get('/embedded-signup/config', whatsappController.embeddedSignupConfig);
router.post('/embedded-signup', authorize('ADMIN'), whatsappController.completeEmbeddedSignup);
router.get('/numbers/:id/subscription', whatsappController.checkSubscription);
// Members can disconnect a number they are working with (it only detaches the
// number from this workspace and returns it to the pool — conversations,
// campaigns and template history are all preserved). Connecting and
// onboarding a new number stay admin-only, since those provision billable
// resources against the business account.
router.delete('/numbers/:id', authorize('CLIENT'), whatsappController.disconnect);

export default router;
