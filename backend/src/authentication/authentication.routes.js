import { Router } from 'express';
import { authenticateApiKey } from '../middleware/authenticateApiKey.js';
import { requireScope } from '../lib/apiScopes.js';
import { rateLimit, apiKeyIdentity, recipientIdentity } from '../middleware/rateLimit.js';
import * as authenticationController from './authentication.controller.js';

const router = Router();

// Authentication OTP is part of the public API.
// It uses API-key authentication, not dashboard JWT authentication.
router.use(rateLimit({ windowMs: 60_000, max: 600, keyPrefix: 'otp-api-ip' }));
router.use(authenticateApiKey);

// Each OTP is a paid message to a real person. Per key, and per destination
// number so a key cannot be used to bombard one phone with codes.
const generatePerKey = rateLimit({ windowMs: 60_000, max: 30, keyPrefix: 'otp-generate', by: apiKeyIdentity });
const generatePerPhone = rateLimit({ windowMs: 10 * 60_000, max: 5, keyPrefix: 'otp-generate-to', by: recipientIdentity('to') });
// Verification is already capped per transaction; these bound guessing across
// transactions.
const verifyPerKey = rateLimit({ windowMs: 60_000, max: 120, keyPrefix: 'otp-verify', by: apiKeyIdentity });
const verifyPerPhone = rateLimit({ windowMs: 10 * 60_000, max: 20, keyPrefix: 'otp-verify-to', by: recipientIdentity('phone') });

// Send a WhatsApp Authentication OTP.
router.post(
  '/generate',
  requireScope('authentication:send'),
  generatePerKey,
  generatePerPhone,
  authenticationController.generateOtp
);

// Verify a ChatFlow-generated Authentication OTP.
router.post(
  '/verify',
  requireScope('authentication:send'),
  verifyPerKey,
  verifyPerPhone,
  authenticationController.verifyOtp
);

export default router;