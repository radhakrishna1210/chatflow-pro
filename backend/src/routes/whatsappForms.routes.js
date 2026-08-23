// WhatsApp Forms routes
import { Router } from 'express';
import * as whatsappFormsController from '../controllers/whatsappForms.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { validate, whatsappFormSchemas } from '../validators/index.js';

const router = Router({ mergeParams: true });

router.use(authenticate, workspaceContext);

// Must precede '/:id/...' style routes so "templates" isn't read as an id.
router.get('/templates', whatsappFormsController.listTemplates);
router.get('/', whatsappFormsController.listForms);
router.get('/:id/submissions', whatsappFormsController.listSubmissions);
router.post('/', validate({ body: whatsappFormSchemas.create }), whatsappFormsController.createForm);
router.patch('/:id', validate({ body: whatsappFormSchemas.update }), whatsappFormsController.updateForm);
router.delete('/:id', whatsappFormsController.deleteForm);

export default router;
