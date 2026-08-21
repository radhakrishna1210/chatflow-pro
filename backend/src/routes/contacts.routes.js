import { Router } from 'express';
import multer from 'multer';
import * as contactsController from '../controllers/contacts.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { validate, contactSchemas } from '../validators/index.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const router = Router({ mergeParams: true });

router.use(authenticate, workspaceContext);

router.get('/', contactsController.list);
router.post('/', validate({ body: contactSchemas.create }), contactsController.create);
router.post('/import', upload.single('file'), contactsController.importCsv);
// Literal path before '/:id' so it is not read as a contact id.
router.get('/tags', contactsController.tags);
// Literal path, before '/:id'. Takes the same filters as the list endpoint.
router.get('/export', contactsController.exportCsv);
router.get('/:id', contactsController.getOne);
router.delete('/:id', contactsController.remove);
router.patch('/:id', validate({ body: contactSchemas.update }), contactsController.update);

export default router;
