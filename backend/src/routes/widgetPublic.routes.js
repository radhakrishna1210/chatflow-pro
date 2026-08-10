import { Router } from 'express';
import * as controller from '../controllers/widgetPublic.controller.js';
import { rateLimit } from '../middleware/rateLimit.js';

// Mounted OUTSIDE /api/v1, at /widget/v1, because these URLs end up in the
// page source of customers' websites — they are part of the product's public
// surface, not of its private API, and should not move when the API version
// does.
//
// Everything here is unauthenticated. Three things stand in for auth:
//   1. the public widget key, which selects the widget and therefore the
//      workspace — a caller can never name a workspace itself;
//   2. the customer's allowed-domain list, checked against the Origin header
//      in every handler;
//   3. rate limits, because the AI endpoint spends the platform's model quota
//      on behalf of an anonymous visitor.
const router = Router();

// Preflight for the JSON endpoints. The allow-list is what actually restricts
// a widget; this only decides whether the browser hands the response back.
router.options('/:key/*splat', (req, res) => {
  const origin = req.get('Origin');
  if (origin) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
  }
  res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.set('Access-Control-Max-Age', '86400');
  res.status(204).send();
});

// One script for every customer, carrying no configuration and no credentials.
router.get('/loader.js', controller.loader);

// Fetched on every page load, so the limit is generous; it is also what makes
// a settings change take effect without reinstalling the snippet.
router.get('/:key/config', rateLimit({ windowMs: 60_000, max: 120, keyPrefix: 'widget-config' }), controller.config);

// The expensive one: each call can cost a query embedding and a generation.
// Tighter than the rest for the same reason the platform assistant's is —
// a person asks a question every few seconds, a script would drain the day's
// budget in a minute.
router.post('/:key/ask', rateLimit({ windowMs: 60_000, max: 12, keyPrefix: 'widget-ask' }), controller.ask);

router.post('/:key/handoff', rateLimit({ windowMs: 60_000, max: 30, keyPrefix: 'widget-handoff' }), controller.handoff);
router.post('/:key/lead', rateLimit({ windowMs: 60_000, max: 10, keyPrefix: 'widget-lead' }), controller.lead);
router.post('/:key/event', rateLimit({ windowMs: 60_000, max: 120, keyPrefix: 'widget-event' }), controller.event);

export default router;
