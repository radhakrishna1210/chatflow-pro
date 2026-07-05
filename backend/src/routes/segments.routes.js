// Segments routes (Smart Lists)
import { Router } from 'express';
import * as segmentsController from '../controllers/segments.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { authorize } from '../middleware/authorize.js';

const router = Router({ mergeParams: true });

// Apply authentication and workspace context to all routes
router.use(authenticate, workspaceContext);

// Segment CRUD
router.get('/', segmentsController.listSegments);
router.post('/', authorize('ADMIN'), segmentsController.createSegment);
router.patch('/:id', authorize('ADMIN'), segmentsController.updateSegment);
router.delete('/:id', authorize('ADMIN'), segmentsController.deleteSegment);

// Contact association within a segment
router.post('/:id/contacts', authorize('ADMIN'), segmentsController.addContactToSegment);
router.patch('/:id/contacts/:contactId', authorize('ADMIN'), segmentsController.updateContactInSegment);
router.delete('/:id/contacts/:contactId', authorize('ADMIN'), segmentsController.removeContactFromSegment);

export default router;
