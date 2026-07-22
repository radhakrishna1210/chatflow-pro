// WhatsApp Forms routes
import { Router } from 'express';
import * as whatsappFormsController from '../controllers/whatsappForms.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { authorize } from '../middleware/authorize.js';
import { validate, whatsappFormSchemas } from '../validators/index.js';

const router = Router({ mergeParams: true });

router.use(authenticate, workspaceContext);

router.get('/', authorize('ADMIN'), whatsappFormsController.listForms);
router.post('/', authorize('ADMIN'), validate({ body: whatsappFormSchemas.create }), whatsappFormsController.createForm);
router.patch('/:id', authorize('ADMIN'), validate({ body: whatsappFormSchemas.update }), whatsappFormsController.updateForm);
router.delete('/:id', authorize('ADMIN'), whatsappFormsController.deleteForm);

export default router;
