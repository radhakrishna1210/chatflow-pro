import { Router } from 'express';
import { authenticateApiKey } from '../middleware/authenticateApiKey.js';
import { requireScope } from '../lib/apiScopes.js';
import * as authenticationController from './authentication.controller.js';

const router = Router();

// Authentication OTP is part of the public API.
// It uses API-key authentication, not dashboard JWT authentication.
router.use(authenticateApiKey);

// Send a WhatsApp Authentication OTP.
router.post(
  '/generate',
  requireScope('authentication:send'),
  authenticationController.generateOtp
);

// Verify a ChatFlow-generated Authentication OTP.
router.post(
  '/verify',
  requireScope('authentication:send'),
  authenticationController.verifyOtp
);

export default router;