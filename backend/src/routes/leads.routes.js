import { Router } from 'express';
import * as leadsController from '../controllers/leads.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { authorize } from '../middleware/authorize.js';
import { validate, leadSchemas } from '../validators/index.js';
import { requireCrmPermission, CRM_PERMISSIONS } from '../services/crmPermissions.service.js';

const router = Router({ mergeParams: true });

router.use(authenticate, workspaceContext);

router.get('/', leadsController.list);
router.post('/', authorize('CLIENT'), validate({ body: leadSchemas.create }), leadsController.create);
router.get('/:id', leadsController.get);
router.patch('/:id', authorize('CLIENT'), validate({ body: leadSchemas.update }), leadsController.update);
router.delete('/:id', requireCrmPermission(CRM_PERMISSIONS.LEAD_DELETE), leadsController.remove);
router.post('/bulk-delete', requireCrmPermission(CRM_PERMISSIONS.LEAD_DELETE), validate({ body: leadSchemas.bulkIds }), leadsController.bulkRemove);
router.post('/bulk-assign', requireCrmPermission(CRM_PERMISSIONS.LEAD_BULK_ASSIGN), validate({ body: leadSchemas.bulkAssign }), leadsController.bulkAssign);
router.post('/bulk-status', authorize('CLIENT'), validate({ body: leadSchemas.bulkStatus }), leadsController.bulkStatus);
router.post('/bulk-category', authorize('CLIENT'), validate({ body: leadSchemas.bulkCategory }), leadsController.bulkCategory);
router.post('/bulk-task', authorize('CLIENT'), validate({ body: leadSchemas.bulkTask }), leadsController.bulkTask);
router.post('/:id/recalculate-score', authorize('CLIENT'), leadsController.recalculateScore);
router.post('/:id/convert', authorize('CLIENT'), validate({ body: leadSchemas.convert }), leadsController.convert);

export default router;
