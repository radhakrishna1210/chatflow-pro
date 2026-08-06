import { Router } from 'express';
import multer from 'multer';
import * as templatesController from '../controllers/templates.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { authorize } from '../middleware/authorize.js';
import { validate, templateSchemas } from '../validators/index.js';

const router = Router({ mergeParams: true });

router.use(authenticate, workspaceContext);

// Header samples go straight to Meta, so the ceiling matches its largest
// accepted header (100 MB for a PDF); per-format limits are enforced in
// lib/meta.js once the real mime type is known.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

router.get('/',                   templatesController.list);
router.post('/',                  authorize('ADMIN'), validate({ body: templateSchemas.create }), templatesController.create);
// Literal paths before '/:id' so they are not read as a template id.
// `upload.single` also parses the multipart body; a JSON body (the generated
// image arriving as a data URI) passes straight through it untouched.
router.post('/media',             authorize('ADMIN'), upload.single('file'), templatesController.uploadMedia);
router.get('/media/:assetId',     templatesController.headerImage);
router.get('/ai/suggestions',     templatesController.aiSuggestions);
router.post('/ai/draft',          authorize('ADMIN'), templatesController.aiDraft);
router.post('/ai/image',          authorize('ADMIN'), templatesController.aiImage);
router.post('/sync-from-meta',    authorize('ADMIN'), templatesController.syncFromMeta);
router.get('/library',            templatesController.library);
router.post('/library/:libId/install', authorize('ADMIN'), templatesController.installLibrary);
router.get('/:id',                templatesController.getOne);
router.put('/:id',                authorize('ADMIN'), validate({ body: templateSchemas.update }), templatesController.update);
router.delete('/:id',             authorize('ADMIN'), templatesController.remove);
router.post('/:id/duplicate',     authorize('ADMIN'), templatesController.duplicate);
router.post('/:id/utility-variant', authorize('ADMIN'), templatesController.utilityVariant);

export default router;
