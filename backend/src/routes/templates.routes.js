import { Router } from 'express';
import multer from 'multer';
import * as templatesController from '../controllers/templates.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { validate, templateSchemas } from '../validators/index.js';

const router = Router({ mergeParams: true });

router.use(authenticate, workspaceContext);

// Header samples go straight to Meta, so the ceiling matches its largest
// accepted header (100 MB for a PDF); per-format limits are enforced in
// lib/meta.js once the real mime type is known.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

router.get('/',                   templatesController.list);
router.post('/',                  validate({ body: templateSchemas.create }), templatesController.create);
// Literal paths before '/:id' so they are not read as a template id.
// `upload.single` also parses the multipart body; a JSON body (the generated
// image arriving as a data URI) passes straight through it untouched.
router.post('/media',             upload.single('file'), templatesController.uploadMedia);
router.get('/media/:assetId',     templatesController.headerImage);
router.get('/ai/suggestions',     templatesController.aiSuggestions);
router.post('/ai/draft',          templatesController.aiDraft);
router.post('/ai/image',          templatesController.aiImage);
router.post('/sync-from-meta',    templatesController.syncFromMeta);
router.get('/library',            templatesController.library);
router.post('/library/:libId/install', templatesController.installLibrary);
router.get('/:id',                templatesController.getOne);
router.put('/:id',                validate({ body: templateSchemas.update }), templatesController.update);
router.delete('/:id',             templatesController.remove);
router.post('/:id/duplicate',     templatesController.duplicate);
router.post('/:id/restore',       templatesController.restore);
router.post('/:id/utility-variant', templatesController.utilityVariant);

export default router;
