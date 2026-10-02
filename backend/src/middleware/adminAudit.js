import * as audit from '../services/audit.service.js';
import { redactUrl } from '../lib/logger.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Catch-all for the super-admin router: a successful write whose handler did
// not record a specific audit row (it sets `req.adminAudited`) still gets a
// generic one, so a route added later cannot silently escape the trail. Body
// keys are logged, never values — they can be credentials.
export function auditAdminWrites(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  res.on('finish', () => {
    if (req.adminAudited || res.statusCode >= 400) return;
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    audit.record({
      actor: { id: req.user?.id, email: req.user?.email },
      action: 'admin.write',
      targetType: 'route',
      targetLabel: `${req.method} ${redactUrl(req.originalUrl, { query: false })}`,
      reason: typeof body.reason === 'string' ? body.reason : null,
      meta: { bodyKeys: Object.keys(body).slice(0, 40), status: res.statusCode },
    });
  });
  next();
}
