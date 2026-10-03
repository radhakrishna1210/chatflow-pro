import { assertPlanFeature } from '../services/planFeatures.service.js';

// Gates a route (or a whole route surface, e.g. Workflows) behind a plan
// feature flag, mirroring the frontend's existing "Coming Soon" upsell
// pattern (README §12.4) instead of returning a generic error. The flags and
// the upgrade message live in services/planFeatures.service.js.
export function requireFeature(flag) {
  return async (req, res, next) => {
    try {
      await assertPlanFeature(req.user.workspaceId, flag);
    } catch (err) {
      if (err.code !== 'PLAN_FEATURE_LOCKED') return next(err);
      return res.status(403).json({
        error: err.message,
        code: err.code,
        feature: flag,
        upgradeTo: err.details?.upgradeTo ?? null,
      });
    }
    next();
  };
}
