// Publishes a realtime event after a successful write through a router, for
// screens whose changes come mostly from people (templates, campaigns): one
// line in the route file rather than one per handler.
//
// `publish({ workspaceId, id })` gets the workspace and the first path segment
// under the router — the resource id for '/:id/…' routes, or a literal such as
// 'sync-from-meta', which callers filter out. It runs only once the response has
// gone out with a 2xx/3xx, so a refused write announces nothing.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function realtimeOnWrite(publish) {
  return (req, res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();
    // Read now: by the time 'finish' fires the router has moved on and
    // req.path/req.params may no longer describe this route.
    const workspaceId = req.params?.workspaceId ?? null;
    const id = String(req.path || '').split('/')[1] || null;
    res.on('finish', () => {
      if (res.statusCode >= 400) return;
      if (!workspaceId) return;
      try { publish({ workspaceId, id }); } catch { /* never fail a write over a notification */ }
    });
    next();
  };
}
