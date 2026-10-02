import { Router } from 'express';
import * as aiAgentsController from '../controllers/aiAgents.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { authorize } from '../middleware/authorize.js';
import { validate, aiAgentsStudioSchemas as s } from '../validators/index.js';

const router = Router({ mergeParams: true });

router.use(authenticate, workspaceContext);

// Reads are open to every member. Anything that changes an agent, a channel or
// the CRM — including the WhatsApp channel, which drives the live bot — is
// member-level work (CLIENT and up), like the rest of the AI agent settings.
router.get('/', aiAgentsController.listAgents);
router.post('/', authorize('CLIENT'), validate({ body: s.createAgent }), aiAgentsController.createAgent);

router.get('/channels', aiAgentsController.listChannels);
router.put('/channels/:channelKey', authorize('CLIENT'), validate({ params: s.channelParams, body: s.updateChannel }), aiAgentsController.updateChannel);

router.get('/guidelines', aiAgentsController.listGuidelines);
router.get('/actions', aiAgentsController.listActions);
router.post('/actions/execute', authorize('CLIENT'), validate({ body: s.executeAction }), aiAgentsController.executeAction);

router.put('/:id', authorize('CLIENT'), validate({ body: s.updateAgent }), aiAgentsController.updateAgent);
router.delete('/:id', authorize('CLIENT'), aiAgentsController.deleteAgent);
// Spends LLM quota, so it is held to the same role as editing the agent.
router.post('/:id/test', authorize('CLIENT'), validate({ body: s.test }), aiAgentsController.testAgent);

export default router;
