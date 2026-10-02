import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { authorize } from '../middleware/authorize.js';
import { validate, gamificationSchemas } from '../validators/index.js';
import * as controller from '../controllers/gamification.controller.js';

const router = Router({ mergeParams: true });
router.use(authenticate, workspaceContext);

// Your own profile only — there is no route to read someone else's, because a
// colleague's XP is not information anyone needs.
router.get('/me', controller.profile);
// The leaderboard reports name, points and level: nothing a colleague could
// not already see, and never pipeline value (§64).
router.get('/leaderboard', controller.leaderboard);
// Whether the leaderboard exists at all is a workspace decision.
router.get('/settings', controller.settings);
router.put('/settings', authorize('ADMIN'), validate({ body: gamificationSchemas.settings }), controller.updateSettings);

export default router;
