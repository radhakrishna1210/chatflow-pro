import { Router } from 'express';
import * as webhookController from '../controllers/webhook.controller.js';
import * as razorpayWebhookController from '../controllers/razorpayWebhook.controller.js';

const router = Router();

router.get('/meta', webhookController.verify);
router.post('/meta', webhookController.receive);
// Razorpay server-to-server payment events, HMAC-verified on the raw body.
router.post('/razorpay', razorpayWebhookController.receive);

export default router;
