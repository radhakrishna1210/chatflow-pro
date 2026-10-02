import { Router } from 'express';
import * as settingsController from '../controllers/settings.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { authorize } from '../middleware/authorize.js';
import { validate, settingsSchemas } from '../validators/index.js';

const router = Router({ mergeParams: true });

router.use(authenticate, workspaceContext);

// Where workspace events (messages, contacts, statuses) are POSTed is an
// admin decision; the rest of the settings stay member-editable.
const requireAdmin = authorize('ADMIN');
const adminForWebhookFields = (req, res, next) => (
  req.body && ('webhookUrl' in req.body || 'webhookEvents' in req.body)
    ? requireAdmin(req, res, next)
    : next()
);

router.get('/', settingsController.getSettings);
router.patch('/', validate({ body: settingsSchemas.update }), adminForWebhookFields, settingsController.updateSettings);
router.get('/invoices', settingsController.getInvoices);
router.get('/invoices/:invoiceId/download', settingsController.downloadInvoice);
router.post('/webhook/test', requireAdmin, settingsController.testWebhook);

export default router;
