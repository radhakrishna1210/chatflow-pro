import { Router } from 'express';
import * as usersController from '../controllers/users.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { validate, userSchemas } from '../validators/index.js';

// User-scoped (not workspace-scoped) — profile applies to the account itself,
// including super admins who have no workspace at all.
const router = Router();
router.use(authenticate);

router.get('/me', usersController.getMe);
router.patch('/me', validate({ body: userSchemas.updateProfile }), usersController.updateMe);
router.post('/me/password', validate({ body: userSchemas.changePassword }), usersController.changePassword);
router.get('/me/sessions', usersController.listSessions);
router.post('/me/sessions/revoke-others', usersController.revokeOtherSessions);
// Preview first so the UI can spell out exactly what deletion destroys.
router.get('/me/deletion-preview', usersController.deletionPreview);
router.delete('/me', validate({ body: userSchemas.deleteAccount }), usersController.deleteMe);

export default router;
