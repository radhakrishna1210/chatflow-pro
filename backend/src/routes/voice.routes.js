import { Router } from 'express';
import * as ctrl from '../controllers/voice.controller.js';

// Public Twilio Programmable Voice webhooks. Auth is the Twilio request
// signature (verifyTwilioSignature), not a JWT — Twilio can't carry one.
const router = Router();

router.post('/incoming', ctrl.verifyTwilioSignature, ctrl.incoming);
router.post('/respond', ctrl.verifyTwilioSignature, ctrl.respond);
router.post('/status', ctrl.verifyTwilioSignature, ctrl.status);

export default router;
