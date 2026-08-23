import * as pub from '../services/widgetPublic.service.js';
import { widgetLoaderScript } from '../services/widgetScript.js';

// The visitor-facing endpoints, called from a third-party website by the
// embedded widget. Everything here is unauthenticated and CORS-enabled, so
// each handler resolves the widget from its public key and enforces the
// customer's domain allow-list before doing anything.

// The loader is public, cacheable and identical for every customer — it
// carries no configuration at all, which is what lets a settings change take
// effect without the customer touching their site again.
export function loader(req, res) {
  res.set('Content-Type', 'application/javascript; charset=utf-8');
  res.set('Cache-Control', 'public, max-age=300');
  res.set('Access-Control-Allow-Origin', '*');
  res.send(widgetLoaderScript());
}

// CORS for the JSON endpoints. The allow-list check is what actually restricts
// a widget; this header exists so an allowed page's browser will hand the
// response back to the script.
function allowOrigin(req, res) {
  const origin = req.get('Origin');
  if (origin) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
  }
}

export async function config(req, res) {
  const widget = await pub.widgetByKey(req.params.key);
  pub.assertOriginAllowed(widget, req.get('Origin'));
  allowOrigin(req, res);

  if (!widget.enabled) {
    // A disabled widget answers, but tells the loader to render nothing. The
    // alternative — a 404 — looks like a broken install to the customer.
    res.json({ key: widget.publicKey, enabled: false });
    return;
  }

  const payload = await pub.publicConfig(widget);
  // Impressions are counted here: this is fetched exactly once per page view
  // that actually renders the widget.
  pub.recordEvent(widget, 'IMPRESSION', { meta: { pageUrl: req.get('Referer') || null } });
  res.json(payload);
}

export async function ask(req, res) {
  const widget = await pub.widgetByKey(req.params.key);
  pub.assertOriginAllowed(widget, req.get('Origin'));
  allowOrigin(req, res);

  const result = await pub.askWidget(widget, {
    question: req.body?.question,
    visitorKey: req.body?.visitorKey,
    pageUrl: req.body?.pageUrl,
  });
  res.json(result);
}

export async function handoff(req, res) {
  const widget = await pub.widgetByKey(req.params.key);
  pub.assertOriginAllowed(widget, req.get('Origin'));
  allowOrigin(req, res);

  res.json(await pub.handoff(widget, {
    visitorKey: req.body?.visitorKey,
    pageUrl: req.body?.pageUrl,
  }));
}

export async function lead(req, res) {
  const widget = await pub.widgetByKey(req.params.key);
  pub.assertOriginAllowed(widget, req.get('Origin'));
  allowOrigin(req, res);

  res.json(await pub.captureLead(widget, {
    visitorKey: req.body?.visitorKey,
    fields: req.body?.fields,
    pageUrl: req.body?.pageUrl,
  }));
}

// Opens and other UI-level events. Deliberately fire-and-forget: an analytics
// beacon must never make the widget look broken, so this always answers 204.
export async function event(req, res) {
  allowOrigin(req, res);
  try {
    const widget = await pub.widgetByKey(req.params.key);
    pub.assertOriginAllowed(widget, req.get('Origin'));
    await pub.recordEvent(widget, String(req.body?.type || '').toUpperCase(), {
      visitorKey: req.body?.visitorKey || null,
      meta: req.body?.meta ?? null,
    });
  } catch {
    // Swallowed on purpose — see above.
  }
  res.status(204).send();
}
