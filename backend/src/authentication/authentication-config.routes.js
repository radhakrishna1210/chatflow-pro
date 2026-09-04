import { Router } from 'express';

import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';

import * as authenticationConfigController from './authentication-config.controller.js';

const router = Router({ mergeParams: true });

/*
 * Authentication configuration is a dashboard/workspace API.
 *
 * It uses the existing workspace JWT authentication,
 * not the public Authentication API key.
 */
router.use(authenticate, workspaceContext);

// Get Authentication configuration and available resources.
router.get(
  '/',
  authenticationConfigController.getConfiguration
);

// Save Authentication configuration.
router.patch(
  '/',
  authenticationConfigController.updateConfiguration
);

export default router;