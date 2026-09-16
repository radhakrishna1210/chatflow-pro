/**
 * ChatFlow's OAuth authorization endpoints.
 *
 * Mounted unauthenticated at /oauth. Auth is applied per-route rather than to
 * the whole router, because the entire point of `authorize` is to accept a
 * visitor who may not have an account yet and walk them through getting one.
 *
 * Every route here is rate-limited. The api-keys routes have never been, and
 * these mint credentials — an unthrottled token endpoint is somewhere to guess
 * authorization codes, and an unthrottled authorize endpoint is somewhere to
 * enumerate client ids.
 */
import { Router } from 'express';
import express from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { rateLimit } from '../middleware/rateLimit.js';
import * as ctrl from '../controllers/oauth.controller.js';

const router = Router();

// A standard OAuth token request is form-encoded, and this router is mounted
// before any global body parser can be assumed — parse both shapes here so a
// client that sends JSON also works.
router.use(express.urlencoded({ extended: false }));
router.use(express.json());

const authorizeLimiter = rateLimit({ windowMs: 15 * 60_000, max: 60, keyPrefix: 'oauth-authorize' });

// Tighter, and counting failures only: a legitimate connect exchanges exactly
// one code, so a caller producing repeated failures is guessing.
const tokenLimiter = rateLimit({ windowMs: 15 * 60_000, max: 30, keyPrefix: 'oauth-token', countFailuresOnly: true });

const decideLimiter = rateLimit({ windowMs: 15 * 60_000, max: 30, keyPrefix: 'oauth-decide' });

// ── Browser-facing ───────────────────────────────────────────────────────────
router.get('/authorize', authorizeLimiter, ctrl.authorize);
router.get('/consent-info', authenticate, decideLimiter, ctrl.consentInfo);
router.post('/consent/decide', authenticate, decideLimiter, ctrl.decide);

// ── Client-facing (server to server, authenticated by client_secret) ─────────
router.post('/token', tokenLimiter, ctrl.token);
router.post('/revoke', tokenLimiter, ctrl.revoke);

export default router;
