import { Router } from 'express';
import * as whatsappController from '../controllers/whatsapp.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { authorize } from '../middleware/authorize.js';
import { validate, whatsappSchemas } from '../validators/index.js';

const router = Router({ mergeParams: true });

router.use(authenticate, workspaceContext);

router.get('/numbers', whatsappController.listNumbers);
router.post('/numbers/refresh', whatsappController.refreshNumbers);
// Connecting or onboarding a number provisions billable resources against a
// business account, and the pool is platform inventory — all admin-only.
const requireAdmin = authorize('ADMIN');
router.post('/numbers/connect-own', requireAdmin, validate({ body: whatsappSchemas.connectOwn }), whatsappController.connectOwnNumber);
router.get('/numbers/pool', requireAdmin, whatsappController.listPool);
router.post('/onboard', requireAdmin, whatsappController.onboard);
router.get('/embedded-signup/config', whatsappController.embeddedSignupConfig);
router.post('/embedded-signup', requireAdmin, whatsappController.completeEmbeddedSignup);
router.get('/numbers/:id/subscription', whatsappController.checkSubscription);
// Live diagnosis: token, number, verification and webhook subscription, each
// with what to do when it fails.
router.get('/numbers/:id/health', whatsappController.health);
// Reconnecting replaces credentials in place. Connecting a *new* number is
// admin-only above; this repairs one the workspace already has.
router.post('/numbers/:id/reconnect', whatsappController.reconnect);
// Number verification. Meta rate-limits code requests hard, so this is
// throttled here too rather than letting users burn the allowance.
router.post('/numbers/:id/request-code',
  rateLimit({ windowMs: 15 * 60_000, max: 5, keyPrefix: 'wa-verify' }),
  whatsappController.requestVerification);
router.post('/numbers/:id/verify-code',
  rateLimit({ windowMs: 15 * 60_000, max: 10, keyPrefix: 'wa-verify-code' }),
  whatsappController.confirmVerification);
// Disconnecting detaches the number from this workspace and returns it to the
// pool (conversations, campaigns and template history are preserved), but it
// stops all sending and receiving, so it is admin-only like connecting.
router.delete('/numbers/:id', requireAdmin, whatsappController.disconnect);

export default router;
