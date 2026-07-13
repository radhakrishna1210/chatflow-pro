import { Router } from 'express';
import { chatWithAi } from '../controllers/onboarding.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { rateLimit } from '../middleware/rateLimit.js';

const router = Router();

// Requires a valid session: the AI agent creates/deletes workspace resources
// and burns LLM quota — it must never be reachable anonymously.
router.post('/chat', authenticate, rateLimit({ windowMs: 60_000, max: 30, keyPrefix: 'ai-chat' }), chatWithAi);

export default router;
