import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { authorize } from '../middleware/authorize.js';
import * as crmDataController from '../controllers/crmData.controller.js';
import { uploader, verifyFileContents, ACCEPTS } from '../lib/uploadGuard.js';

const router = Router({ mergeParams: true });
// CSV only, and the bytes must not look binary — the same guard the contact
// import uses (lib/uploadGuard.js). Plain multer took any file type.
const upload = uploader(ACCEPTS.csv, 10 * 1024 * 1024);

router.use(authenticate, workspaceContext);

// Exporting takes customer data out of the workspace, so it is an admin action
// and every run is logged.
router.get('/export/:entity', authorize('ADMIN'), crmDataController.exportCsv);

router.post('/import/leads/preview', authorize('CLIENT'), upload.single('file'), verifyFileContents, crmDataController.previewImport);
router.post('/import/leads', authorize('CLIENT'), upload.single('file'), verifyFileContents, crmDataController.runImport);

export default router;
