import { Router } from 'express';
import multer from 'multer';
import * as contactsController from '../controllers/contacts.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { authorize } from '../middleware/authorize.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const router = Router({ mergeParams: true });

router.use(authenticate, workspaceContext);

router.get('/', contactsController.list);
router.post('/', authorize('CLIENT'), contactsController.create);
router.post('/import', authorize('CLIENT'), upload.single('file'), contactsController.importCsv);
router.delete('/:id', authorize('CLIENT'), contactsController.remove);
router.patch('/:id', authorize('CLIENT'), contactsController.update);

export default router;
