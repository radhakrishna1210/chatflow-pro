// Segments routes (Smart Lists)
import { Router } from 'express';
import * as segmentsController from '../controllers/segments.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { authorize } from '../middleware/authorize.js';
import { validate, segmentSchemas, contactSchemas } from '../validators/index.js';

const router = Router({ mergeParams: true });

// Apply authentication and workspace context to all routes
router.use(authenticate, workspaceContext);

// Segment CRUD
router.get('/', segmentsController.listSegments);
router.post('/', authorize('ADMIN'), validate({ body: segmentSchemas.create }), segmentsController.createSegment);
router.patch('/:id', authorize('ADMIN'), validate({ body: segmentSchemas.update }), segmentsController.updateSegment);
router.delete('/:id', authorize('ADMIN'), segmentsController.deleteSegment);

// Contact association within a segment
router.post('/:id/contacts', authorize('ADMIN'), segmentsController.addContactToSegment);
router.patch('/:id/contacts/:contactId', authorize('ADMIN'), validate({ body: contactSchemas.update }), segmentsController.updateContactInSegment);
router.delete('/:id/contacts/:contactId', authorize('ADMIN'), segmentsController.removeContactFromSegment);

export default router;
