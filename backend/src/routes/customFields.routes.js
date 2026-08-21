// Custom fields and custom events — the storage behind two add-ons that were
// purchasable while nothing implemented them.
import { Router } from 'express';
import * as ctrl from '../controllers/customFields.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { authorize } from '../middleware/authorize.js';

const router = Router({ mergeParams: true });
router.use(authenticate, workspaceContext);

// Reading the definitions is day-to-day work — the contact form needs them.
// Defining a field changes what every contact record looks like, so it sits at
// the same CLIENT bar as the rest of the workspace's configuration.
router.get('/fields', ctrl.listFields);
router.post('/fields', authorize('CLIENT'), ctrl.createField);
router.patch('/fields/:id', authorize('CLIENT'), ctrl.updateField);
router.delete('/fields/:id', authorize('CLIENT'), ctrl.deleteField);

router.get('/events', ctrl.listEvents);
router.post('/events', authorize('CLIENT'), ctrl.createEvent);
router.delete('/events/:id', authorize('CLIENT'), ctrl.deleteEvent);
// Recording an occurrence is what an integration does, not an administrator.
router.post('/events/:key/track', ctrl.trackEvent);

export default router;
