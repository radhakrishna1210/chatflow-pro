import { Router } from 'express';
import * as ctrl from '../controllers/onboardingAgent.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { workspaceContext } from '../middleware/workspaceContext.js';
import { validate, onboardingAgentSchemas } from '../validators/index.js';

// The onboarding agent: describe a setup, review the blueprint, apply it.
//
// Membership, suspension and the read-only floor for viewers come from
// workspaceContext, the same as every other workspace route. There is no plan
// feature flag here: what limits use is AI credits (services/aiCredits), which
// every plan carries a number of. What a build may create is still checked
// against the plan when it is applied.
const router = Router({ mergeParams: true });
router.use(authenticate, workspaceContext);

router.get('/builds', ctrl.list);
router.post('/builds', validate({ body: onboardingAgentSchemas.create }), ctrl.create);
router.get('/usage', ctrl.usage);
router.get('/builds/:id', ctrl.get);
router.delete('/builds/:id', ctrl.remove);
router.post('/builds/:id/messages', validate({ body: onboardingAgentSchemas.message }), ctrl.message);
router.put('/builds/:id/items/:key', validate({ body: onboardingAgentSchemas.item }), ctrl.updateItem);
router.delete('/builds/:id/items/:key', ctrl.removeItem);
router.post('/builds/:id/apply', validate({ body: onboardingAgentSchemas.apply }), ctrl.apply);
router.post('/builds/:id/live', validate({ body: onboardingAgentSchemas.live }), ctrl.live);

export default router;
