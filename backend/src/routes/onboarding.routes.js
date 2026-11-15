import { Router } from 'express';
import { chatWithAi } from '../controllers/onboarding.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { workspaceAiModelContext } from '../middleware/workspaceContext.js';

const router = Router();

// Requires a valid session: the AI agent creates/deletes workspace resources
// and burns LLM quota — it must never be reachable anonymously.
// workspaceAiModelContext: the onboarding assistant builds templates, automations
// and campaigns from a single prompt, and does it with the workspace's own AI
// model when the super admin has pinned one.
router.post('/chat', authenticate, workspaceAiModelContext, rateLimit({ windowMs: 60_000, max: 30, keyPrefix: 'ai-chat' }), chatWithAi);

export default router;
