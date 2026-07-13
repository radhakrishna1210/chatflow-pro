import { randomBytes } from 'crypto';
import * as authService from '../services/auth.service.js';
import { redis } from '../lib/redis.js';
import { env } from '../config/env.js';

export async function register(req, res) {
  const result = await authService.register(req.body);
  res.status(201).json(result);
}

// ─── OTP signup ───────────────────────────────────────────────────────────────
export async function startSignup(req, res) {
  const result = await authService.startSignup(req.body);
  res.json(result);
}
export async function verifySignup(req, res) {
  const result = await authService.verifySignup(req.body);
  res.status(201).json(result);
}
export async function resendSignupOtp(req, res) {
  const result = await authService.resendSignupOtp(req.body);
  res.json(result);
}

export async function login(req, res) {
  const result = await authService.login(req.body);
  res.json(result);
}

export async function refresh(req, res) {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ error: 'refreshToken required' });
  const result = await authService.refresh(refreshToken);
  res.json(result);
}

export async function logout(req, res) {
  const { refreshToken } = req.body;
  await authService.logout(refreshToken);
  res.json({ message: 'Logged out successfully' });
}

// Tokens must never travel in a redirect URL (browser history, proxy/CDN
// logs, Referer leakage). Instead we stash the session under a short-lived
// one-time code in Redis and redirect with only that code; the SPA exchanges
// it via POST /auth/exchange.
export async function googleCallback(req, res) {
  const session = req.user; // { accessToken, refreshToken, user, workspace }
  const code = randomBytes(32).toString('hex');
  try {
    await redis.set(`oauth:code:${code}`, JSON.stringify(session), 'EX', 120);
    return res.redirect(`${env.CLIENT_URL}/auth/callback?code=${code}`);
  } catch (err) {
    console.error('[Google OAuth] Failed to store one-time code:', err.message);
    return res.redirect(`${env.CLIENT_URL}/login?oauth_error=session_store_failed`);
  }
}

export async function exchangeOneTimeCode(req, res) {
  const { code } = req.body || {};
  if (!code || !/^[0-9a-f]{64}$/.test(code)) {
    return res.status(400).json({ error: 'Invalid code' });
  }
  const key = `oauth:code:${code}`;
  const raw = await redis.get(key);
  if (!raw) return res.status(400).json({ error: 'Code expired or already used' });
  await redis.del(key); // single use
  res.json(JSON.parse(raw));
}
