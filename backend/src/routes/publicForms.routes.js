import { Router } from 'express';
import { rateLimit } from '../middleware/rateLimit.js';
import { validate, leadFormSchemas } from '../validators/index.js';
import * as formsController from '../controllers/leadForms.controller.js';

// The only unauthenticated write path in the CRM. Mounted outside the
// workspace router on purpose: there is no session to derive a workspace from,
// so it is named explicitly in the URL and the form must be active.
const router = Router({ mergeParams: true });

// Reading a form definition is cheap but still worth bounding — otherwise the
// endpoint is a free way to probe for valid slugs at speed.
router.get(
  '/:workspaceId/:slug',
  rateLimit({ windowMs: 60_000, max: 60, keyPrefix: 'form-get' }),
  formsController.publicGet,
);

// Submissions are the expensive path: each one can create a contact and a
// lead. A tighter bucket, plus the honeypot handled in the service.
router.post(
  '/:workspaceId/:slug',
  rateLimit({ windowMs: 60_000, max: 10, keyPrefix: 'form-post' }),
  validate({ body: leadFormSchemas.submit }),
  formsController.publicSubmit,
);

export default router;
