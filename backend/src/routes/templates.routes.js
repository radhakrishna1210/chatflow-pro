import { Router } from 'express';
import * as templatesController from '../controllers/templates.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { authorize } from '../middleware/authorize.js';

const router = Router({ mergeParams: true });

router.use(authenticate, workspaceContext);

router.get('/',                   templatesController.list);
router.post('/',                  authorize('CLIENT'), templatesController.create);
router.post('/sync-from-meta',    templatesController.syncFromMeta);
router.get('/library',            templatesController.library);
router.post('/library/:libId/install', authorize('CLIENT'), templatesController.installLibrary);
router.get('/:id',                templatesController.getOne);
router.put('/:id',                authorize('CLIENT'), templatesController.update);
router.delete('/:id',             authorize('CLIENT'), templatesController.remove);
router.post('/:id/duplicate',     authorize('CLIENT'), templatesController.duplicate);

export default router;
