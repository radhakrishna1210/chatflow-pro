import { env } from '../config/env.js';
import { mintStreamToken, streamHub } from '../services/realtime.service.js';

// A one-minute token for opening the event stream (EventSource cannot send an
// Authorization header). GET so every workspace role can fetch it under the
// read-only capability floor; no-store so no cache ever keeps one.
export function token(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!env.REALTIME_ENABLED) {
    return res.status(503).json({ error: 'Live updates are turned off on this server.', code: 'REALTIME_DISABLED' });
  }
  const { token: streamToken, expiresIn } = mintStreamToken(req.user, req.params.workspaceId);
  res.json({ token: streamToken, expiresIn, workspaceId: req.params.workspaceId });
}

export function stream(req, res) {
  if (!env.REALTIME_ENABLED) {
    return res.status(503).json({ error: 'Live updates are turned off on this server.', code: 'REALTIME_DISABLED' });
  }
  streamHub().open(req, res);
}
