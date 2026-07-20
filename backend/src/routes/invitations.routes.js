import { Router } from 'express';
import * as controller from '../controllers/invitations.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { authorize } from '../middleware/authorize.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { validate, invitationSchemas } from '../validators/index.js';

// Prevents a compromised/careless admin session (or a buggy retry loop) from
// blasting invite emails to arbitrary addresses.
const inviteLimiter = rateLimit({ windowMs: 15 * 60_000, max: 30, keyPrefix: 'invite-create' });
// Token lookups/accepts are unauthenticated-reachable (getByToken) or
// low-friction (accept) — every other credential/token endpoint in this app
// is rate limited, so these shouldn't be the exception.
const tokenLimiter = rateLimit({ windowMs: 15 * 60_000, max: 60, keyPrefix: 'invite-token' });

// Admin-management routes (mounted at /workspaces/:workspaceId/invitations).
const router = Router({ mergeParams: true });
router.use(authenticate, workspaceContext);

router.post('/', inviteLimiter, authorize('ADMIN'), validate({ body: invitationSchemas.create }), controller.create);
router.get('/', authorize('ADMIN'), controller.list);
router.post('/:id/resend', inviteLimiter, authorize('ADMIN'), controller.resend);
router.delete('/:id', authorize('ADMIN'), controller.revoke);

export default router;

// Public token routes (mounted at /invitations) — accepting an invite means
// the WorkspaceMember row doesn't exist yet, so workspaceContext can't run;
// getByToken doesn't even require a session (the accept-invite page needs
// to preview it before the visitor has logged in).
export const publicInvitationsRouter = Router();
publicInvitationsRouter.get('/:token', tokenLimiter, controller.getByToken);
publicInvitationsRouter.post('/:token/accept', tokenLimiter, authenticate, controller.accept);
