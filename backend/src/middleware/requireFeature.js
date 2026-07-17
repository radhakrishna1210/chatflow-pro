import { hasFeature } from '../services/subscription.service.js';

// Gates an entire route surface (e.g. Workflows, Integrations) behind a plan
// feature flag, mirroring the frontend's existing "Coming Soon" upsell
// pattern (README §12.4) instead of returning a generic error.
export function requireFeature(flag) {
  return async (req, res, next) => {
    const allowed = await hasFeature(req.user.workspaceId, flag);
    if (!allowed) {
      return res.status(403).json({
        error: `This feature isn't included in your current plan. Upgrade to unlock it.`,
        code: 'PLAN_FEATURE_LOCKED',
        feature: flag,
      });
    }
    next();
  };
}
