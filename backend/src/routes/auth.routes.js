import { Router } from 'express';
import passport from 'passport';
import * as authController from '../controllers/auth.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { env } from '../config/env.js';

const router = Router();

router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/refresh', authController.refresh);
router.post('/logout', authController.logout);

router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'], prompt: 'select_account' }));
router.get('/google/callback', (req, res, next) => {
  passport.authenticate('google', { session: false }, (err, user) => {
    if (err) {
      const reason = err.code || err.message || 'oauth_error';
      console.error(`[Google OAuth] ${reason} — expected redirect_uri="${env.GOOGLE_CALLBACK_URL}". Check that this exact URL is in Google Cloud Console → Credentials → Authorized redirect URIs.`);
      return res.redirect(`${env.CLIENT_URL}/login?oauth_error=${encodeURIComponent(reason)}`);
    }
    if (!user) return res.redirect(`${env.CLIENT_URL}/login?oauth_error=denied`);
    req.user = user;
    return authController.googleCallback(req, res, next);
  })(req, res, next);
});

router.get('/meta/callback', async (req, res) => {
  const { code, workspaceId } = req.query;
  if (!code) return res.status(400).json({ error: 'Missing code' });

  try {
    const { exchangeCodeForToken, getLongLivedToken, getWabaPhoneNumbers } = await import('../lib/meta.js');
    const { encrypt } = await import('../lib/encryption.js');
    const { prisma } = await import('../lib/prisma.js');
    const { env } = await import('../config/env.js');

    const shortTokenData = await exchangeCodeForToken(code);
    const longTokenData = await getLongLivedToken(shortTokenData.access_token);
    const longToken = longTokenData.access_token;

    const numbers = await getWabaPhoneNumbers(env.META_WABA_ID);
    const encrypted = encrypt(longToken);

    for (const num of numbers) {
      const existing = await prisma.waNumber.findFirst({
        where: { workspaceId, metaPhoneNumberId: num.id },
      });
      if (existing) {
        await prisma.waNumber.update({
          where: { id: existing.id },
          data: { displayName: num.verified_name, status: num.status, encryptedAccessToken: encrypted },
        });
      } else {
        await prisma.waNumber.create({
          data: {
            workspaceId,
            phoneNumber: num.display_phone_number,
            metaPhoneNumberId: num.id,
            wabaId: env.META_WABA_ID,
            encryptedAccessToken: encrypted,
            displayName: num.verified_name,
            status: num.status,
          },
        });
      }
    }

    res.redirect(`${env.CLIENT_URL}/settings/whatsapp?connected=true`);
  } catch (err) {
    console.error('[Meta OAuth]', err);
    res.status(500).json({ error: 'OAuth exchange failed' });
  }
});

export default router;
