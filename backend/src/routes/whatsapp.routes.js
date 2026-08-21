import { Router } from 'express';
import * as whatsappController from '../controllers/whatsapp.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { rateLimit } from '../middleware/rateLimit.js';

const router = Router({ mergeParams: true });

router.use(authenticate, workspaceContext);

router.get('/numbers', whatsappController.listNumbers);
router.post('/numbers/refresh', whatsappController.refreshNumbers);
router.post('/numbers/connect-own', whatsappController.connectOwnNumber);
router.get('/numbers/pool', whatsappController.listPool);
router.post('/onboard', whatsappController.onboard);
router.get('/embedded-signup/config', whatsappController.embeddedSignupConfig);
router.post('/embedded-signup', whatsappController.completeEmbeddedSignup);
router.get('/numbers/:id/subscription', whatsappController.checkSubscription);
// Number verification. Meta rate-limits code requests hard, so this is
// throttled here too rather than letting users burn the allowance.
router.post('/numbers/:id/request-code',
  rateLimit({ windowMs: 15 * 60_000, max: 5, keyPrefix: 'wa-verify' }),
  whatsappController.requestVerification);
router.post('/numbers/:id/verify-code',
  rateLimit({ windowMs: 15 * 60_000, max: 10, keyPrefix: 'wa-verify-code' }),
  whatsappController.confirmVerification);
// Members can disconnect a number they are working with (it only detaches the
// number from this workspace and returns it to the pool — conversations,
// campaigns and template history are all preserved). Connecting and
// onboarding a new number stay admin-only, since those provision billable
// resources against the business account.
router.delete('/numbers/:id', whatsappController.disconnect);

export default router;
