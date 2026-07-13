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
router.delete('/:id', contactsController.remove);
router.patch('/:id', validate({ body: contactSchemas.update }), contactsController.update);

export default router;
