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

export async function register({ name, email, password }) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    const err = new Error('Email already in use');
    err.status = 409;
    throw err;
  }

  const superAdmin = isPlatformAdmin(email);
  const passwordHash = await bcrypt.hash(password, env.BCRYPT_SALT_ROUNDS);
  const user = await prisma.user.create({ data: { name, email, passwordHash } });

  // The creator is always the ADMIN of their own workspace.
  const role = 'ADMIN';
  const workspace = await prisma.workspace.create({
    data: {
      name: `${name}'s Workspace`,
      members: { create: { userId: user.id, role } },
    },
  });

  const { accessToken, refreshToken } = generateTokens(user.id, workspace.id, role, superAdmin);
  await storeRefreshToken(user.id, refreshToken);

  queueWelcomeEmail({ email: user.email, name: user.name }).catch(() => {});

  return {
    accessToken, refreshToken,
    user: { id: user.id, name: user.name, email: user.email, role, superAdmin },
    workspace: { id: workspace.id, name: workspace.name },
  };
}

export async function login({ email, password }) {
  const user = await prisma.user.findUnique({ where: { email } });
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

  const member = await prisma.workspaceMember.findFirst({
    where: { userId: user.id },
    include: { workspace: true },
    orderBy: { joinedAt: 'asc' },
  });

  if (!member) {
    const err = new Error('No workspace found');
    err.status = 404;
    throw err;
  }

  const superAdmin = isPlatformAdmin(user.email);
  const role = member.role;
  const { accessToken, refreshToken } = generateTokens(user.id, member.workspaceId, role, superAdmin);
  await storeRefreshToken(user.id, refreshToken);

  return {
    accessToken,
    refreshToken,
    user: { id: user.id, name: user.name, email: user.email, role, superAdmin },
    workspace: { id: member.workspaceId, name: member.workspace.name },
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

  if (!member) {
    const err = new Error('No workspace found for user');
    err.status = 401;
    throw err;
  }

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user) {
    const err = new Error('User not found');
    err.status = 401;
    throw err;
  }

  const superAdmin = isPlatformAdmin(user.email);
  const role = member.role;
  const { accessToken, refreshToken: newRefreshToken } = generateTokens(
    payload.sub,
    member.workspaceId,
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
  let user = await prisma.user.findFirst({
    where: { OR: [{ googleId }, { email }] },
  });

  if (user) {
    if (!user.googleId) {
      user = await prisma.user.update({ where: { id: user.id }, data: { googleId } });
    }
  } else {
    user = await prisma.user.create({ data: { name, email, googleId } });
    await prisma.workspace.create({
      data: {
        name: `${name}'s Workspace`,
        members: { create: { userId: user.id, role: 'ADMIN' } },
      },
    });
  }

  let member = await prisma.workspaceMember.findFirst({
    where: { userId: user.id },
    include: { workspace: true },
    orderBy: { joinedAt: 'asc' },
  });

  // Self-heal: a user can exist without a workspace if a previous signup was
  // interrupted between user creation and workspace creation.
  if (!member) {
    await prisma.workspace.create({
      data: {
        name: `${user.name}'s Workspace`,
        members: { create: { userId: user.id, role: 'ADMIN' } },
      },
    });
    member = await prisma.workspaceMember.findFirst({
      where: { userId: user.id },
      include: { workspace: true },
      orderBy: { joinedAt: 'asc' },
    });
  }

  const superAdmin = isPlatformAdmin(user.email);
  const role = member.role;
  const { accessToken, refreshToken } = generateTokens(user.id, member.workspaceId, role, superAdmin);
  await storeRefreshToken(user.id, refreshToken);

  return {
    accessToken,
    refreshToken,
    user: { id: user.id, name: user.name, email: user.email, role, superAdmin },
    workspace: { id: member.workspaceId, name: member.workspace.name },
  };
}

// ─── OTP-verified email signup ────────────────────────────────────────────────
// User creation is gated behind email verification: startSignup emails a code
// and stashes the pending name+passwordHash on the EmailOtp row; the real User
// + Workspace are only created once verifySignup confirms the code.

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

export async function verifySignup({ email, code }) {
  const normalizedEmail = String(email).trim().toLowerCase();
  const otp = await prisma.emailOtp.findFirst({
    where: { email: normalizedEmail, purpose: 'SIGNUP', consumed: false },
    orderBy: { createdAt: 'desc' },
  });
  if (!otp) { const e = new Error('No pending verification. Please start signup again.'); e.status = 400; throw e; }
  if (otp.expiresAt < new Date()) { const e = new Error('Code expired. Please request a new one.'); e.status = 400; throw e; }
  if (otp.attempts >= MAX_OTP_ATTEMPTS) { const e = new Error('Too many incorrect attempts. Please start signup again.'); e.status = 429; throw e; }

  if (otp.codeHash !== hashCode(code)) {
    await prisma.emailOtp.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
    const e = new Error('Incorrect code'); e.status = 400; throw e;
  }

  // Double-check email still free (race).
  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existing) { const e = new Error('Email already in use'); e.status = 409; throw e; }

  const superAdmin = isPlatformAdmin(normalizedEmail);
  const role = 'ADMIN';
  const user = await prisma.user.create({ data: { name: otp.name, email: normalizedEmail, passwordHash: otp.passwordHash } });
  const workspace = await prisma.workspace.create({
    data: { name: `${otp.name}'s Workspace`, members: { create: { userId: user.id, role } } },
  });
  await prisma.emailOtp.update({ where: { id: otp.id }, data: { consumed: true } });

  const { accessToken, refreshToken } = generateTokens(user.id, workspace.id, role, superAdmin);
  await storeRefreshToken(user.id, refreshToken);
  queueWelcomeEmail({ email: user.email, name: user.name }).catch(() => {});

  return {
    accessToken, refreshToken,
    user: { id: user.id, name: user.name, email: user.email, role, superAdmin },
    workspace: { id: workspace.id, name: workspace.name },
  };
}
