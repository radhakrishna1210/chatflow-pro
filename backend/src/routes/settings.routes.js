import { Router } from 'express';
import * as settingsController from '../controllers/settings.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { authorize } from '../middleware/authorize.js';
import { validate, settingsSchemas } from '../validators/index.js';

const router = Router({ mergeParams: true });

router.use(authenticate, workspaceContext);

router.get('/', settingsController.getSettings);
router.patch('/', authorize('ADMIN'), validate({ body: settingsSchemas.update }), settingsController.updateSettings);
router.get('/invoices', settingsController.getInvoices);
router.post('/webhook/test', authorize('ADMIN'), settingsController.testWebhook);

export default router;
