import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { authorize } from '../middleware/authorize.js';
import { validate, teamSchemas } from '../validators/index.js';
import * as teamsController from '../controllers/teams.controller.js';

const router = Router({ mergeParams: true });
router.use(authenticate, workspaceContext);

// Everyone may read teams — a member needs to know who their colleagues are.
// Changing team membership or the visibility mode decides who can see whose
// records, which is granting access, so it sits with ADMIN alongside the other
// access-granting routes.
router.get('/', teamsController.list);
router.get('/visibility', teamsController.getVisibility);
router.post('/', authorize('ADMIN'), validate({ body: teamSchemas.create }), teamsController.create);
router.patch('/visibility', authorize('ADMIN'), validate({ body: teamSchemas.visibility }), teamsController.setVisibility);
router.patch('/:id', authorize('ADMIN'), validate({ body: teamSchemas.update }), teamsController.update);
router.put('/:id/members', authorize('ADMIN'), validate({ body: teamSchemas.members }), teamsController.setMembers);
router.delete('/:id', authorize('ADMIN'), teamsController.remove);

export default router;
