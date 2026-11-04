import { Router } from 'express';
import * as contactsController from '../controllers/contacts.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { authorize } from '../middleware/authorize.js';
import { validate, contactSchemas } from '../validators/index.js';
import { uploader, verifyFileContents, ACCEPTS } from '../lib/uploadGuard.js';

// CSV only, and the bytes must not look binary — see lib/uploadGuard.js.
const upload = uploader(ACCEPTS.csv, 10 * 1024 * 1024);
const router = Router({ mergeParams: true });

router.use(authenticate, workspaceContext);

router.get('/', contactsController.list);
router.post('/', validate({ body: contactSchemas.create }), contactsController.create);
router.post('/import', upload.single('file'), verifyFileContents, contactsController.importCsv);
// Literal path before '/:id' so it is not read as a contact id.
router.get('/tags', contactsController.tags);
// Literal path, before '/:id'. Takes the same filters as the list endpoint.
// Exporting the whole contact book is a bulk data-egress action, not inbox
// work: members and admins only (the CRM export is admin-only). Agents and
// viewers can still read contacts one screen at a time.
router.get('/export', authorize('CLIENT'), contactsController.exportCsv);
// Literal path, before '/:id'. What a campaign can fill template variables with.
router.get('/variable-sources', contactsController.variableSources);
router.get('/:id', contactsController.getOne);
router.delete('/:id', contactsController.remove);
router.patch('/:id', validate({ body: contactSchemas.update }), contactsController.update);

export default router;
