import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID, randomInt, createHash } from 'crypto';
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import { queueWelcomeEmail, queueSignupOtpEmail } from './email.service.js';

function generateTokens(userId, workspaceId, role, superAdmin = false) {
  const accessToken = jwt.sign(
    { sub: userId, workspaceId, role, superAdmin },
    env.JWT_ACCESS_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN }
  );
  // jti guarantees uniqueness — two refresh tokens signed for the same user in
  // the same second would otherwise be byte-identical and collide with the
  // RefreshToken.token unique constraint.
  const refreshToken = jwt.sign(
    { sub: userId, jti: randomUUID() },
    env.JWT_REFRESH_SECRET,
    { expiresIn: env.JWT_REFRESH_EXPIRES_IN }
  );
  return { accessToken, refreshToken };
}

// Parse durations like '15m' / '7d' / '12h' into milliseconds.
function parseDurationMs(value, fallbackMs) {
  const m = /^(\d+)\s*(ms|s|m|h|d)$/.exec(String(value || '').trim());
  if (!m) return fallbackMs;
  const mult = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2]];
  return parseInt(m[1], 10) * mult;
}

const REFRESH_TTL_MS = parseDurationMs(env.JWT_REFRESH_EXPIRES_IN, 7 * 86_400_000);

async function storeRefreshToken(userId, token) {
  const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);
  await prisma.refreshToken.create({ data: { userId, token, expiresAt } });
  // Opportunistic cleanup so expired tokens don't pile up forever.
  prisma.refreshToken.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => {});
}

// Platform-level super admin, identified solely by the configured ADMIN_EMAIL.
// This is separate from a workspace's ADMIN role (WorkspaceMember.role).
function isPlatformAdmin(email) {
  return email.toLowerCase() === env.ADMIN_EMAIL.toLowerCase();
}

export async function register({ name, email, password, role = 'CLIENT' }) {
  const normalizedEmail = String(email).trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existing) {
    const err = new Error('Email already in use');
    err.status = 409;
    throw err;
  }

  const superAdmin = isPlatformAdmin(normalizedEmail);
  const passwordHash = await bcrypt.hash(password, env.BCRYPT_SALT_ROUNDS);
  const user = await prisma.user.create({ data: { name, email: normalizedEmail, passwordHash } });

  // No workspace yet: the user becomes ADMIN only when they explicitly create
  // one (createWorkspace), or CLIENT when an admin invites them.
  const { accessToken, refreshToken } = generateTokens(user.id, null, null, superAdmin);
  await storeRefreshToken(user.id, refreshToken);

  queueWelcomeEmail({ email: user.email, name: user.name }).catch(() => {});

  return {
    accessToken, refreshToken,
    user: { id: user.id, name: user.name, email: user.email, role: null, superAdmin },
    workspace: null,
  };
}

export async function login({ email, password }) {
  const normalizedEmail = String(email).trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (!user || !user.passwordHash) {
    const err = new Error('Invalid credentials');
    err.status = 401;
    throw err;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    const err = new Error('Invalid credentials');
    err.status = 401;
    throw err;
  }

  // A user without a workspace is still allowed to log in — the client sends
  // them to workspace setup (create one, or wait for an invite).
  const member = await prisma.workspaceMember.findFirst({
    where: { userId: user.id },
    include: { workspace: true },
    orderBy: { joinedAt: 'asc' },
  });

  const superAdmin = isPlatformAdmin(user.email);
  const role = member?.role ?? null;
  const { accessToken, refreshToken } = generateTokens(user.id, member?.workspaceId ?? null, role, superAdmin);
  await storeRefreshToken(user.id, refreshToken);

  return {
    accessToken,
    refreshToken,
    user: { id: user.id, name: user.name, email: user.email, role, superAdmin },
    workspace: member ? { id: member.workspaceId, name: member.workspace.name } : null,
  };
}

export async function refresh(token) {
  let payload;
  try {
    payload = jwt.verify(token, env.JWT_REFRESH_SECRET);
  } catch {
    const err = new Error('Invalid refresh token');
    err.status = 401;
    throw err;
  }

  const stored = await prisma.refreshToken.findUnique({ where: { token } });
  if (!stored || stored.expiresAt < new Date()) {
    if (stored) await prisma.refreshToken.delete({ where: { token } }).catch(() => {});
    const err = new Error('Refresh token expired or not found');
    err.status = 401;
    throw err;
  }

  await prisma.refreshToken.delete({ where: { token } });

  const member = await prisma.workspaceMember.findFirst({
    where: { userId: payload.sub },
    include: { workspace: true },
    orderBy: { joinedAt: 'asc' },
  });

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user) {
    const err = new Error('User not found');
    err.status = 401;
    throw err;
  }

  const superAdmin = isPlatformAdmin(user.email);
  const role = member?.role ?? null;
  const { accessToken, refreshToken: newRefreshToken } = generateTokens(
    payload.sub,
    member?.workspaceId ?? null,
    role,
    superAdmin
  );
  await storeRefreshToken(payload.sub, newRefreshToken);

  return { accessToken, refreshToken: newRefreshToken };
}

export async function logout(token) {
  if (token) {
    await prisma.refreshToken.deleteMany({ where: { token } });
  }
}

export async function findOrCreateGoogleUser({ googleId, email, name }) {
  const normalizedEmail = email ? String(email).trim().toLowerCase() : null;
  let user = await prisma.user.findFirst({
    where: {
      OR: [
        { googleId },
        ...(normalizedEmail ? [{ email: normalizedEmail }] : []),
      ],
    },
  });

  if (user) {
    if (!user.googleId) {
      user = await prisma.user.update({ where: { id: user.id }, data: { googleId } });
    }
  } else {
    // New Google users get no workspace: they become ADMIN only by explicitly
    // creating one (createWorkspace), or CLIENT when an admin invites them.
    user = await prisma.user.create({ data: { name, email, googleId } });
  }

  const member = await prisma.workspaceMember.findFirst({
    where: { userId: user.id },
    include: { workspace: true },
    orderBy: { joinedAt: 'asc' },
  });

  const superAdmin = isPlatformAdmin(user.email);
  const role = member?.role ?? null;
  const { accessToken, refreshToken } = generateTokens(user.id, member?.workspaceId ?? null, role, superAdmin);
  await storeRefreshToken(user.id, refreshToken);

  return {
    accessToken,
    refreshToken,
    user: { id: user.id, name: user.name, email: user.email, role, superAdmin },
    workspace: member ? { id: member.workspaceId, name: member.workspace.name } : null,
  };
}

// ─── OTP-verified email signup ────────────────────────────────────────────────
// User creation is gated behind email verification: startSignup emails a code
// and stashes the pending name+passwordHash on the EmailOtp row; the real User
// is only created once verifySignup confirms the code.

const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;
const hashCode = (code) => createHash('sha256').update(String(code)).digest('hex');

export async function startSignup({ name, email, password }) {
  const normalizedEmail = String(email).trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existing) { const e = new Error('Email already in use'); e.status = 409; throw e; }

  // Rate-limit: block resend spam by reusing a recent unconsumed code window.
  const recent = await prisma.emailOtp.findFirst({
    where: { email: normalizedEmail, purpose: 'SIGNUP', consumed: false, createdAt: { gt: new Date(Date.now() - 60 * 1000) } },
    orderBy: { createdAt: 'desc' },
  });
  if (recent) { const e = new Error('A code was just sent — please wait a minute before requesting another.'); e.status = 429; throw e; }

  // Invalidate any prior pending codes for this email.
  await prisma.emailOtp.updateMany({ where: { email: normalizedEmail, purpose: 'SIGNUP', consumed: false }, data: { consumed: true } });

  const code = String(randomInt(100000, 1000000));
  const passwordHash = await bcrypt.hash(password, env.BCRYPT_SALT_ROUNDS);

  await prisma.emailOtp.create({
    data: {
      email: normalizedEmail, codeHash: hashCode(code), purpose: 'SIGNUP',
      name, passwordHash, expiresAt: new Date(Date.now() + OTP_TTL_MS),
    },
  });
  await queueSignupOtpEmail({ email: normalizedEmail, name, code }).catch((err) => {
    console.error('[auth] Failed to queue OTP email:', err.message);
  });

  return { email: normalizedEmail, message: 'Verification code sent' };
}

export async function resendSignupOtp({ email }) {
  const normalizedEmail = String(email).trim().toLowerCase();
  const pending = await prisma.emailOtp.findFirst({
    where: { email: normalizedEmail, purpose: 'SIGNUP', consumed: false },
    orderBy: { createdAt: 'desc' },
  });
  if (!pending) { const e = new Error('No pending signup for this email. Start signup again.'); e.status = 404; throw e; }
  if (pending.createdAt > new Date(Date.now() - 60 * 1000)) {
    const e = new Error('A code was just sent — please wait a minute before requesting another.'); e.status = 429; throw e;
  }

  // Issue a fresh code on a new row, carrying over the already-hashed password.
  await prisma.emailOtp.update({ where: { id: pending.id }, data: { consumed: true } });
  const code = String(randomInt(100000, 1000000));
  await prisma.emailOtp.create({
    data: {
      email: normalizedEmail, codeHash: hashCode(code), purpose: 'SIGNUP',
      name: pending.name, passwordHash: pending.passwordHash, expiresAt: new Date(Date.now() + OTP_TTL_MS),
    },
  });
  await queueSignupOtpEmail({ email: normalizedEmail, name: pending.name, code }).catch((err) => {
    console.error('[auth] Failed to queue OTP resend email:', err.message);
  });
  return { email: normalizedEmail, message: 'Verification code re-sent' };
}

export async function verifySignup({ email, code, role = 'CLIENT' }) {
  const normalizedEmail = String(email).trim().toLowerCase();
  const otp = await prisma.emailOtp.findFirst({
    where: { email: normalizedEmail, purpose: 'SIGNUP', consumed: false },
    orderBy: { createdAt: 'desc' },
  });

  if (!otp) {
    const err = new Error('No verification code found');
    err.status = 404;
    throw err;
  }

  if (otp.expiresAt < new Date()) {
    const err = new Error('Verification code expired');
    err.status = 400;
    throw err;
  }

  if (otp.codeHash !== hashCode(code)) {
    const err = new Error('Incorrect code');
    err.status = 400;
    throw err;
  }

  // Consume the code
  await prisma.emailOtp.update({ where: { id: otp.id }, data: { consumed: true } });

  // Check if a user registered with this email while they were waiting to verify
  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existing) {
    const err = new Error('Email already in use');
    err.status = 409;
    throw err;
  }

  const superAdmin = isPlatformAdmin(normalizedEmail);
  // No workspace yet: the user becomes ADMIN only when they explicitly create
  // one (createWorkspace), or CLIENT when an admin invites them.
  const user = await prisma.user.create({ data: { name: otp.name, email: normalizedEmail, passwordHash: otp.passwordHash } });
  await prisma.emailOtp.update({ where: { id: otp.id }, data: { consumed: true } });

  const { accessToken, refreshToken } = generateTokens(user.id, null, null, superAdmin);
  await storeRefreshToken(user.id, refreshToken);

  return {
    accessToken, refreshToken,
    user: { id: user.id, name: user.name, email: user.email, role: null, superAdmin },
    workspace: null,
  };
}

// ─── Workspace creation ───────────────────────────────────────────────────────
// The ONLY place a user gains the ADMIN role: explicitly creating a workspace.
export async function createWorkspace(userId, { name } = {}) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) { const e = new Error('User not found'); e.status = 404; throw e; }

  const existing = await prisma.workspaceMember.findFirst({ where: { userId } });
  if (existing) { const e = new Error('You already belong to a workspace'); e.status = 409; throw e; }

  const role = 'ADMIN';

  // Every workspace needs a Subscription from the moment it exists — plan
  // limit/feature enforcement (README §12.4) requires one, and there's no
  // other point where it gets bootstrapped for workspaces created after the
  // initial backfill-subscriptions.js migration. Defaults to FREE.
  const freePlan = await prisma.plan.findUnique({ where: { key: 'FREE' } });
  const periodStart = new Date();
  const periodEnd = new Date(periodStart.getTime() + 30 * 24 * 60 * 60 * 1000);

  const workspace = await prisma.workspace.create({
    data: {
      name: (name || '').trim() || `${user.name}'s Workspace`,
      members: { create: { userId, role } },
      ...(freePlan ? {
        subscription: { create: { planId: freePlan.id, status: 'ACTIVE', currentPeriodStart: periodStart, currentPeriodEnd: periodEnd } },
        usageCounters: { create: { periodStart, periodEnd, messagesUsed: 0 } },
      } : {}),
    },
  });

  // Issue fresh tokens carrying the new workspace context so the client can
  // swap its session in place.
  const superAdmin = isPlatformAdmin(user.email);
  const { accessToken, refreshToken } = generateTokens(user.id, workspace.id, role, superAdmin);
  await storeRefreshToken(user.id, refreshToken);

  return {
    accessToken, refreshToken,
    user: { id: user.id, name: user.name, email: user.email, role, superAdmin },
    workspace: { id: workspace.id, name: workspace.name },
  };
}
