import { Router } from 'express';
import * as workflowController from '../controllers/workflow.controller.js';
import * as compilerController from '../controllers/workflowCompiler.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { requireFeature } from '../middleware/requireFeature.js';
import { validate, workflowSchemas, workflowCompilerSchemas } from '../validators/index.js';

const router = Router({ mergeParams: true });

router.use(authenticate, workspaceContext, requireFeature('workflows'));

router.get('/', workflowController.list);
router.get('/runs', workflowController.runs);
router.post('/', validate({ body: workflowSchemas.create }), workflowController.create);
router.patch('/:id', validate({ body: workflowSchemas.update }), workflowController.update);
router.delete('/:id', workflowController.remove);

// Describe an automation in English and get a *draft* workflow back. It is
// saved inactive: a workflow messages customers, so it does not start running
// because someone described it. Activating is the ordinary PATCH.
router.get('/vocabulary', compilerController.vocabulary);
router.post(
  '/compile',
  validate({ body: workflowCompilerSchemas.compile }),
  compilerController.compile,
);

export default router;
