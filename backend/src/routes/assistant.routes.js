import { Router } from 'express';
import * as controller from '../controllers/assistant.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireSuperAdmin } from '../middleware/authorize.js';
import { rateLimit } from '../middleware/rateLimit.js';

const router = Router();

// Public, because the visitor most likely to ask "what does this cost?" does
// not have an account yet. That makes the rate limit the only thing standing
// between an anonymous caller and the platform's AI quota, so it is tighter
// than a logged-in feature would need: a person types a question every few
// seconds at most, while a script would happily spend the day's budget in a
// minute. Refusals short-circuit before any model call, so the limit only
// really binds on questions that are genuinely about the site.
router.post('/chat', rateLimit({ windowMs: 60_000, max: 12, keyPrefix: 'assistant' }), controller.chat);

// Index health, for the admin screen: how many chunks, whether semantic search
// is live, when it last synced. No corpus content, so it needs no auth.
router.get('/status', controller.status);

// Rebuilding the index is a platform-wide action that spends embedding quota.
router.post('/reindex', authenticate, requireSuperAdmin, controller.reindex);

export default router;
