import { Router } from 'express';

import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { authorize } from '../middleware/authorize.js';

import * as authenticationConfigController from './authentication-config.controller.js';

const router = Router({ mergeParams: true });

/*
 * Authentication configuration is a dashboard/workspace API.
 *
 * It uses the existing workspace JWT authentication,
 * not the public Authentication API key.
 */
router.use(authenticate, workspaceContext);

// Authentication API/OTP usage, sourced directly from AuthenticationTransaction
// rather than campaign rows so direct API requests (campaignId = NULL) remain visible.
router.get(
  '/analytics',
  authenticationConfigController.getUsage
);

// Get Authentication configuration and available resources.
router.get(
  '/',
  authenticationConfigController.getConfiguration
);

// Save Authentication configuration. Admin-only: it chooses which number and
// template every OTP is sent (and charged) through.
router.patch(
  '/',
  authorize('ADMIN'),
  authenticationConfigController.updateConfiguration
);

export default router;
