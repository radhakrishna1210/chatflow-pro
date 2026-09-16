import { Router } from 'express';
import * as aiAgentsController from '../controllers/aiAgents.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';

const router = Router({ mergeParams: true });

router.use(authenticate, workspaceContext);

router.get('/', aiAgentsController.listAgents);
router.post('/', aiAgentsController.createAgent);
router.put('/:id', aiAgentsController.updateAgent);
router.delete('/:id', aiAgentsController.deleteAgent);

router.get('/channels', aiAgentsController.listChannels);
router.put('/channels/:channelKey', aiAgentsController.updateChannel);

router.get('/guidelines', aiAgentsController.listGuidelines);
router.get('/actions', aiAgentsController.listActions);
router.post('/actions/execute', aiAgentsController.executeAction);
router.post('/:id/test', aiAgentsController.testAgent);

export default router;
