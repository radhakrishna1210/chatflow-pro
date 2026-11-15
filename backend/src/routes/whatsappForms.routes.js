// WhatsApp Forms routes
import { Router } from 'express';
import * as whatsappFormsController from '../controllers/whatsappForms.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { authorize } from '../middleware/authorize.js';
import { validate, whatsappFormSchemas } from '../validators/index.js';

const router = Router({ mergeParams: true });

router.use(authenticate, workspaceContext);

// Must precede '/:id/...' style routes so "templates" isn't read as an id.
router.get('/templates', whatsappFormsController.listTemplates);
// Workspace setting "Orders with per-customer prices" (lib/ordering.js).
// Members and admins change it; viewers and inbox agents only read it.
router.get('/settings', whatsappFormsController.getSettings);
router.patch('/settings', authorize('CLIENT'), whatsappFormsController.updateSettings);
router.get('/', whatsappFormsController.listForms);
router.get('/:id/submissions', whatsappFormsController.listSubmissions);
router.get('/:id/submissions/export', whatsappFormsController.exportSubmissions);
// The form as one screen (a WhatsApp Flow): tick, fill in, Submit. Publishing
// creates a Flow on the WhatsApp account, so it is for members and admins.
router.get('/:id/screen', whatsappFormsController.getScreen);
router.post('/:id/screen/publish', authorize('CLIENT'), whatsappFormsController.publishScreen);
router.patch('/:id/screen', authorize('CLIENT'), whatsappFormsController.updateScreen);
router.post('/', validate({ body: whatsappFormSchemas.create }), whatsappFormsController.createForm);
router.patch('/:id', validate({ body: whatsappFormSchemas.update }), whatsappFormsController.updateForm);
router.delete('/:id', whatsappFormsController.deleteForm);

export default router;
