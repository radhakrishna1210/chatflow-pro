import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { authorize } from '../middleware/authorize.js';
import { requireCrmPermission, CRM_PERMISSIONS } from '../services/crmPermissions.service.js';
import * as crmDataController from '../controllers/crmData.controller.js';
import { uploader, verifyFileContents, ACCEPTS } from '../lib/uploadGuard.js';

const router = Router({ mergeParams: true });
// Same guard as every other upload: CSV types only, one file, content checked.
const upload = uploader(ACCEPTS.csv, 10 * 1024 * 1024);

router.use(authenticate, workspaceContext);

// Exporting takes customer data out of the workspace, so it is an admin action
// and every run is logged.
router.get('/export/:entity', requireCrmPermission(CRM_PERMISSIONS.LEAD_EXPORT), crmDataController.exportCsv);

router.post('/import/leads/preview', authorize('CLIENT'), upload.single('file'), verifyFileContents, crmDataController.previewImport);
router.post('/import/leads', authorize('CLIENT'), upload.single('file'), verifyFileContents, crmDataController.runImport);

export default router;
