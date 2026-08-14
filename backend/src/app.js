import path from 'node:path';
import { existsSync } from 'node:fs';
import express from 'express';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { env } from './config/env.js';
import { errorHandler } from './middleware/errorHandler.js';
import { findOrCreateGoogleUser } from './services/auth.service.js';
import apiRoutes from './routes/index.js';
import widgetPublicRoutes from './routes/widgetPublic.routes.js';
import { logToFile } from './lib/logger.js';

const app = express();

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logToFile(`${req.method} ${req.url} - Status: ${res.statusCode} (${duration}ms)`);
  });
  next();
});

app.use(express.json({
  limit: env.JSON_BODY_LIMIT,
  verify: (req, _res, buf) => { req.rawBody = buf.toString(); },
}));
app.use(express.urlencoded({ extended: true }));

// CORS — only the configured client origin(s) are allowed. Never `*`:
// a wildcard lets any site on the internet call the API from a victim's browser.
app.use((req, res, next) => {
  // The embeddable website widget is the one thing here that is *meant* to be
  // called cross-origin by sites we do not control, so it cannot use this
  // allow-list — it enforces its own, per widget, from the customer's
  // configured domains. Skipping it here matters specifically because of the
  // OPTIONS short-circuit below: it answers every preflight, so without this
  // the widget's own preflight handler would never run and every JSON POST
  // from a customer's site would fail CORS in the browser.
  if (req.path.startsWith('/widget/v1')) return next();

  const origin = req.headers.origin;
  if (origin && env.CORS_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    res.setHeader('Access-Control-Max-Age', '600');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// An explicit GOOGLE_CALLBACK_URL pointing somewhere other than the API's own
// origin is almost always a stale override — the classic one aims at the Vite
// dev server (5173) instead of the API (4000). Google only reports it as
// `Error 400: redirect_uri_mismatch` on the consent screen, which never reaches
// the server logs, so say it out loud at boot instead.
{
  const callbackOrigin = new URL(env.GOOGLE_CALLBACK_URL).origin;
  const apiOrigin = new URL(env.API_PUBLIC_URL).origin;
  if (callbackOrigin !== apiOrigin) {
    console.warn(
      `[Google OAuth] GOOGLE_CALLBACK_URL (${env.GOOGLE_CALLBACK_URL}) is not on the API origin ${apiOrigin}. ` +
        'Google will reject the sign-in with redirect_uri_mismatch unless this exact URL is registered in ' +
        'Google Cloud Console → Credentials → Authorized redirect URIs.'
    );
  }
}

passport.use(
  new GoogleStrategy(
    {
      clientID: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      callbackURL: env.GOOGLE_CALLBACK_URL,
      passReqToCallback: true, // needed to read req.inviteToken (set by the /google/callback route after verifying state)
    },
    async (req, accessToken, refreshToken, profile, done) => {
      try {
        const result = await findOrCreateGoogleUser({
          googleId: profile.id,
          email: profile.emails?.[0]?.value,
          name: profile.displayName,
          inviteToken: req.inviteToken || null,
        });
        done(null, result);
      } catch (err) {
        done(err, null);
      }
    }
  )
);

app.use(passport.initialize());
app.use('/api/v1', apiRoutes);

// The embeddable website widget's own surface. Mounted outside /api/v1 because
// these URLs are pasted into customers' websites — they must not move when the
// private API version does. Unauthenticated by design; see the route file.
app.use('/widget/v1', widgetPublicRoutes);

// Serve the built frontend from the same service (single-service deploy on
// Render). Skipped when frontend/dist doesn't exist — local dev keeps using
// Vite's dev server and its /api proxy.
const clientDist = path.resolve(import.meta.dirname, '../../frontend/dist');
if (existsSync(path.join(clientDist, 'index.html'))) {
  // Hashed assets are immutable; index.html must never be cached or users get
  // stale bundles after a deploy.
  app.use(express.static(clientDist, { index: false, maxAge: '1y' }));
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path.startsWith('/api/')) return next();
    res.set('Cache-Control', 'no-cache');
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use(errorHandler);

export default app;
