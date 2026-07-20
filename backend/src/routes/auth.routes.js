import { Router } from 'express';
import passport from 'passport';
import { randomBytes } from 'crypto';
import * as authController from '../controllers/auth.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { validate, authSchemas } from '../validators/index.js';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { signState, verifyState } from '../lib/oauthState.js';

const router = Router();

// Brute-force protection on credential + token endpoints.
const loginLimiter   = rateLimit({ windowMs: 15 * 60_000, max: 20,  keyPrefix: 'login' });
const refreshLimiter = rateLimit({ windowMs: 60_000,      max: 60,  keyPrefix: 'refresh' });

router.post('/register', loginLimiter, validate({ body: authSchemas.register }), authController.register);
// OTP-verified email signup (account is created only after the code is verified)
router.post('/register/start',  loginLimiter, validate({ body: authSchemas.signupStart }), authController.startSignup);
router.post('/register/verify', loginLimiter, validate({ body: authSchemas.signupVerify }), authController.verifySignup);
router.post('/register/resend', loginLimiter, validate({ body: authSchemas.signupResend }), authController.resendSignupOtp);
router.post('/login',    loginLimiter, validate({ body: authSchemas.login }),    authController.login);
router.post('/refresh',  refreshLimiter, validate({ body: authSchemas.refresh }), authController.refresh);
router.post('/logout',   authController.logout);
// Exchanges the one-time code issued by the Google callback for real tokens
// (keeps access/refresh tokens out of browser history and server logs).
router.post('/exchange', refreshLimiter, authController.exchangeOneTimeCode);

// ─── Google OAuth ────────────────────────────────────────────────────────────
// A signed `state` value binds the callback to the browser that initiated the
// flow (CSRF protection) without requiring server-side sessions. It also
// carries an in-flight invite token (see ?invite= below) through the round
// trip to Google and back, so "Continue with Google" from an invite link
// doesn't silently drop the invite.
router.get('/google', (req, res, next) => {
  const inviteToken = typeof req.query.invite === 'string' ? req.query.invite : null;
  const state = signState({ n: randomBytes(8).toString('hex'), ts: Date.now(), inviteToken });
  passport.authenticate('google', { scope: ['profile', 'email'], prompt: 'select_account', state, session: false })(req, res, next);
});

router.get('/google/callback', (req, res, next) => {
  const statePayload = verifyState(req.query.state);
  if (!statePayload) {
    console.warn('[Google OAuth] Rejected callback with missing/invalid state (possible CSRF)');
    return res.redirect(`${env.CLIENT_URL}/login?oauth_error=invalid_state`);
  }
  // Read by the passport strategy (passReqToCallback: true) so a pending
  // invite survives the round trip to Google and back.
  req.inviteToken = statePayload.inviteToken || null;
  passport.authenticate('google', { session: false }, (err, user) => {
    if (err) {
      const reason = err.code || err.message || 'oauth_error';
      const detail = err.oauthError?.data || err.oauthError?.message || err.oauthError;
      console.error(`[Google OAuth] ${reason} — expected redirect_uri="${env.GOOGLE_CALLBACK_URL}". Check that this exact URL is in Google Cloud Console → Credentials → Authorized redirect URIs.`);
      console.error('[Google OAuth] underlying error:', detail);
      return res.redirect(`${env.CLIENT_URL}/login?oauth_error=${encodeURIComponent(reason)}`);
    }
    if (!user) return res.redirect(`${env.CLIENT_URL}/login?oauth_error=denied`);
    req.user = user;
    return authController.googleCallback(req, res, next);
  })(req, res, next);
});

// ─── Meta Embedded Signup ────────────────────────────────────────────────────
// Start endpoint: an authenticated workspace admin gets a signed state that
// binds their workspaceId to the OAuth flow. The callback later verifies this
// state, so an attacker can no longer inject numbers into arbitrary
// workspaces by tampering with a query param.
router.get('/meta/start', authenticate, async (req, res) => {
  const workspaceId = req.query.workspaceId || req.user.workspaceId;
  const member = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: req.user.id, workspaceId } },
  });
  if (!member || member.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Only workspace admins can connect WhatsApp numbers' });
  }

  const state = signState({ workspaceId, userId: req.user.id, n: randomBytes(8).toString('hex'), ts: Date.now() });
  const authUrl = new URL(`https://www.facebook.com/${env.META_API_VERSION}/dialog/oauth`);
  authUrl.searchParams.set('client_id', env.META_APP_ID);
  authUrl.searchParams.set('redirect_uri', env.META_REDIRECT_URI);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'whatsapp_business_management,whatsapp_business_messaging,business_management');

  res.json({ url: authUrl.toString(), state });
});

router.get('/meta/callback', async (req, res) => {
  const { code, state } = req.query;
  const { env } = await import('../config/env.js');
  const fail = (reason) => res.redirect(`${env.CLIENT_URL}/dashboard/setup?meta_error=${encodeURIComponent(reason)}`);

  if (!code) return fail('missing_code');
  const payload = verifyState(state, 30 * 60_000);
  if (!payload?.workspaceId) return fail('invalid_state');
  const workspaceId = payload.workspaceId;

  try {
    const { exchangeCodeForToken, getLongLivedToken, getWabaPhoneNumbers, getUserWabas } = await import('../lib/meta.js');
    const { encrypt } = await import('../lib/encryption.js');
    const { prisma } = await import('../lib/prisma.js');

    // Meta requires the exact redirect_uri used in the auth request.
    const shortTokenData = await exchangeCodeForToken(code, env.META_REDIRECT_URI);
    const longTokenData = await getLongLivedToken(shortTokenData.access_token);
    const longToken = longTokenData.access_token;

    // Embedded Signup creates a WABA owned by the *user* — never assume the
    // platform's own META_WABA_ID. Prefer the waba_id from the token exchange
    // (granular scopes), else enumerate the user's businesses.
    let wabaIds = [];
    if (shortTokenData.waba_id) wabaIds = [shortTokenData.waba_id];
    if (wabaIds.length === 0) {
      wabaIds = await getUserWabas(longToken).catch(() => []);
    }
    if (wabaIds.length === 0) return fail('no_waba_found');

    const encrypted = encrypt(longToken);
    let connected = 0;

    for (const wabaId of wabaIds) {
      const numbers = await getWabaPhoneNumbers(wabaId, longToken).catch(() => []);
      for (const num of numbers) {
        const existing = await prisma.waNumber.findFirst({
          where: { workspaceId, metaPhoneNumberId: num.id },
        });
        if (existing) {
          await prisma.waNumber.update({
            where: { id: existing.id },
            data: { displayName: num.verified_name, status: num.status ?? 'ACTIVE', encryptedAccessToken: encrypted, wabaId },
          });
        } else {
          await prisma.waNumber.create({
            data: {
              workspaceId,
              phoneNumber: num.display_phone_number,
              metaPhoneNumberId: num.id,
              wabaId,
              encryptedAccessToken: encrypted,
              displayName: num.verified_name,
              status: num.status ?? 'ACTIVE',
            },
          });
        }
        connected++;
      }
    }

    if (connected === 0) return fail('no_phone_numbers');
    res.redirect(`${env.CLIENT_URL}/dashboard/setup?connected=true`);
  } catch (err) {
    console.error('[Meta OAuth]', err.response?.data || err.message);
    // Always redirect on error — a JSON 500 leaves the OAuth popup hanging.
    return fail('exchange_failed');
  }
});

router.get('/instagram/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect(`${env.CLIENT_URL}/dashboard/integrations?instagram_error=missing_code`);
  // NOTE: real implementation would exchange the code via Instagram Basic Display API.
  return res.redirect(`${env.CLIENT_URL}/dashboard/integrations?instagram_code=${encodeURIComponent(code)}`);
});

export default router;
