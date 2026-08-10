import { Router } from 'express';
import * as widgetsController from '../controllers/widgets.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';

const router = Router({ mergeParams: true });

router.use(authenticate, workspaceContext);

// Literal paths before '/:id' so they are not read as a widget id.
router.get('/analytics', widgetsController.analytics);
router.get('/sessions', widgetsController.sessions);

// The knowledge the widgets' assistant answers from. Workspace-wide rather
// than per-widget: two widgets on one site share one corpus.
router.get('/knowledge', widgetsController.listSources);
router.post('/knowledge', widgetsController.createSource);
router.get('/knowledge/status', widgetsController.knowledgeStatus);
router.post('/knowledge/reindex', widgetsController.reindex);
router.patch('/knowledge/:sourceId', widgetsController.updateSource);
router.post('/knowledge/:sourceId/refresh', widgetsController.refreshSource);
router.delete('/knowledge/:sourceId', widgetsController.removeSource);

router.get('/', widgetsController.list);
router.post('/', widgetsController.create);
router.get('/:id', widgetsController.getOne);
router.patch('/:id', widgetsController.update);
router.delete('/:id', widgetsController.remove);
router.post('/:id/rotate-key', widgetsController.rotateKey);

export default router;
