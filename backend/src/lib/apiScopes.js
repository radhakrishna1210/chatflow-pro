// What an API key is allowed to do.
//
// Keys had no scopes at all, and authenticateApiKey gave every caller
// `role: 'ADMIN'`, so a key created for a read-only reporting script could
// launch campaigns and spend the workspace wallet. The scope list below is
// deliberately small and resource-shaped: it is what the public API in
// routes/public.routes.js actually exposes, no more.

export const API_SCOPES = Object.freeze([
  { id: 'messages:send',     label: 'Send messages',        description: 'Send WhatsApp template and text messages.' },
  { id: 'templates:read',    label: 'Read templates',       description: 'List and read message templates.' },
  { id: 'templates:write',   label: 'Manage templates',     description: 'Create templates and submit them to Meta for review.' },
  { id: 'campaigns:read',    label: 'Read campaigns',       description: 'List campaigns and read their results.' },
  { id: 'campaigns:write',   label: 'Manage campaigns',     description: 'Create campaigns and launch them. Launching spends the wallet.' },
  { id: 'contacts:read',     label: 'Read contacts',        description: 'List and read contacts.' },
  { id: 'contacts:write',    label: 'Manage contacts',      description: 'Create and update contacts.' },
  { id: 'webhooks:write',    label: 'Manage webhooks',      description: 'Change the workspace webhook URL.' },
]);

const VALID = new Set(API_SCOPES.map((s) => s.id));

// The set a key gets when the caller does not choose. Read plus send covers the
// overwhelming majority of integrations and, importantly, excludes the two that
// spend money (campaigns:write) or change where events are delivered
// (webhooks:write) — those have to be asked for deliberately.
export const DEFAULT_SCOPES = Object.freeze([
  'messages:send', 'templates:read', 'campaigns:read', 'contacts:read', 'contacts:write',
]);

export function normaliseScopes(input) {
  if (input == null) return [...DEFAULT_SCOPES];
  const list = Array.isArray(input) ? input : [input];
  const cleaned = [...new Set(list.map((s) => String(s || '').trim()).filter(Boolean))];

  const unknown = cleaned.filter((s) => !VALID.has(s));
  if (unknown.length > 0) {
    const e = new Error(`Unknown API scope${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}`);
    e.status = 400;
    throw e;
  }
  if (cleaned.length === 0) {
    const e = new Error('An API key needs at least one scope.');
    e.status = 400;
    throw e;
  }
  return cleaned;
}

// `null` scopes means a key issued before scopes existed. Those keep full
// access so existing integrations do not break on deploy; every new key is
// issued with an explicit list.
export function keyAllows(apiKey, scope) {
  if (apiKey?.scopes == null) return true;
  const list = Array.isArray(apiKey.scopes) ? apiKey.scopes : [];
  return list.includes(scope);
}

// Route guard. Mounted per route in routes/public.routes.js.
export function requireScope(scope) {
  return (req, res, next) => {
    if (keyAllows(req.apiKey, scope)) return next();
    return res.status(403).json({
      error: `This API key does not have the "${scope}" scope.`,
      code: 'INSUFFICIENT_SCOPE',
      requiredScope: scope,
      grantedScopes: req.apiKey?.scopes ?? [],
    });
  };
}
