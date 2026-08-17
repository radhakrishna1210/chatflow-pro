import { Router } from 'express';
import multer from 'multer';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { authorize } from '../middleware/authorize.js';
import * as crmDataController from '../controllers/crmData.controller.js';

const router = Router({ mergeParams: true });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.use(authenticate, workspaceContext);

// Exporting takes customer data out of the workspace, so it is an admin action
// and every run is logged.
router.get('/export/:entity', authorize('ADMIN'), crmDataController.exportCsv);

router.post('/import/leads/preview', authorize('CLIENT'), upload.single('file'), crmDataController.previewImport);
router.post('/import/leads', authorize('CLIENT'), upload.single('file'), crmDataController.runImport);

export default router;
