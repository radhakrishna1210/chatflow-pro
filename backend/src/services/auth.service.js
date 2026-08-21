import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID, randomInt, createHash, timingSafeEqual } from 'crypto';
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import { queueWelcomeEmail, sendOtpEmailNow } from './email.service.js';
import { consumeInvitationAtomically } from './invitations.service.js';

function generateTokens(userId, workspaceId, role, superAdmin = false) {
  // The access token carries its own `jti` so signing out can revoke *this*
  // token. Without one there is nothing to name in a denylist, which is why a
  // logged-out access token stayed usable for its full 15-minute life.
  const accessToken = jwt.sign(
    { sub: userId, workspaceId, role, superAdmin, jti: randomUUID() },
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

// The pre-check (`findUnique` before creating) always leaves a window for two
// duplicate requests (double form submit, retried network request) to both
// pass it and race on the DB's unique email constraint. Without this, the
// loser gets a raw Prisma P2002 surfaced as a generic 500 instead of the same
// friendly "Email already in use" the pre-check gives everyone else.
function rethrowAsDuplicateEmail(err) {
  if (err.code === 'P2002' && err.meta?.target?.includes?.('email')) {
    const e = new Error('Email already in use');
    e.status = 409;
    throw e;
  }
  throw err;
}

export async function register({ name, email, password, role = 'CLIENT', inviteToken }) {
  const normalizedEmail = String(email).trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existing) {
    const err = new Error('Email already in use');
    err.status = 409;
    throw err;
  }

  const superAdmin = isPlatformAdmin(normalizedEmail);
  const passwordHash = await bcrypt.hash(password, env.BCRYPT_SALT_ROUNDS);

  let joined = null;
  let user;
  try {
    user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({ data: { name, email: normalizedEmail, passwordHash } });
      if (inviteToken) joined = await consumeInvitationAtomically(tx, inviteToken, normalizedEmail, created.id);
      return created;
    });
  } catch (err) {
    rethrowAsDuplicateEmail(err);
  }

  // No workspace yet unless an invite was consumed above: the user becomes
  // ADMIN only when they explicitly create one (createWorkspace), or CLIENT
  // when an invite joins them to an existing workspace.
  const { accessToken, refreshToken } = generateTokens(user.id, joined?.workspaceId ?? null, joined?.role ?? null, superAdmin);
  await storeRefreshToken(user.id, refreshToken);

  queueWelcomeEmail({ email: user.email, name: user.name }).catch(() => {});

  return {
    accessToken, refreshToken,
    user: { id: user.id, name: user.name, email: user.email, role: joined?.role ?? null, superAdmin },
    workspace: joined?.workspace ?? null,
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
  prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }).catch(() => {});

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

export async function findOrCreateGoogleUser({ googleId, email, name, inviteToken }) {
  const normalizedEmail = email ? String(email).trim().toLowerCase() : null;
  let user = await prisma.user.findFirst({
    where: {
      OR: [
        { googleId },
        ...(normalizedEmail ? [{ email: normalizedEmail }] : []),
      ],
    },
  });

  const isNewUser = !user;
  let joined = null;

  if (user) {
    if (!user.googleId) {
      user = await prisma.user.update({ where: { id: user.id }, data: { googleId } });
    }
  } else {
    // New Google users get no workspace unless an invite is consumed below:
    // they become ADMIN only by explicitly creating one (createWorkspace),
    // or CLIENT when an admin invites them.
    try {
      if (inviteToken) {
        user = await prisma.$transaction(async (tx) => {
          const created = await tx.user.create({ data: { name, email, googleId } });
          joined = await consumeInvitationAtomically(tx, inviteToken, normalizedEmail, created.id);
          return created;
        });
      } else {
        user = await prisma.user.create({ data: { name, email, googleId } });
      }
    } catch (err) {
      // A concurrent callback (double-click, browser retry, two OAuth popups)
      // for the same brand-new googleId/email can race here — the loser
      // hits a unique violation instead of a real error. Converge onto
      // whichever row won instead of surfacing a 500.
      if (err.code !== 'P2002') throw err;
      user = await prisma.user.findFirst({ where: { OR: [{ googleId }, ...(normalizedEmail ? [{ email: normalizedEmail }] : [])] } });
      if (!user) throw err;
      joined = null;
    }
  }

  const member = joined
    ? null
    : await prisma.workspaceMember.findFirst({
        where: { userId: user.id },
        include: { workspace: true },
        orderBy: { joinedAt: 'asc' },
      });

  const superAdmin = isPlatformAdmin(user.email);
  const role = joined?.role ?? member?.role ?? null;
  const workspaceId = joined?.workspaceId ?? member?.workspaceId ?? null;
  const { accessToken, refreshToken } = generateTokens(user.id, workspaceId, role, superAdmin);
  await storeRefreshToken(user.id, refreshToken);
  prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }).catch(() => {});

  // Existing users are never auto-joined to an invited workspace here (that
  // still requires the explicit accept-invite step, same as the
  // password-login path) — surface the token so the SPA can route them to
  // /invite/accept instead of silently dropping it.
  const pendingInviteToken = inviteToken && !isNewUser && !joined ? inviteToken : null;

  return {
    accessToken,
    refreshToken,
    user: { id: user.id, name: user.name, email: user.email, role, superAdmin },
    workspace: joined?.workspace ?? (member ? { id: member.workspaceId, name: member.workspace.name } : null),
    ...(pendingInviteToken ? { pendingInviteToken } : {}),
  };
}

// ─── OTP-verified email signup ────────────────────────────────────────────────
// User creation is gated behind email verification: startSignup emails a code
// and stashes the pending name+passwordHash on the EmailOtp row; the real User
// is only created once verifySignup confirms the code.

const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60 * 1000;
const hashCode = (code) => createHash('sha256').update(String(code)).digest('hex');

// Six digits from a CSPRNG. randomInt is rejection-sampled, so every code in
// 100000–999999 is equally likely — Math.random() would be both biased and
// predictable from a few observed codes.
const generateOtp = () => String(randomInt(100000, 1000000));

// Constant-time compare of the two hashes.
//
// `a !== b` on a string leaks, through timing, how many leading characters
// matched. Both sides are fixed-length SHA-256 hex here so the lengths always
// agree, but the comparison is done properly regardless.
function codeMatches(storedHash, suppliedCode) {
  const supplied = hashCode(suppliedCode);
  const a = Buffer.from(String(storedHash));
  const b = Buffer.from(supplied);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// One message for a code that is missing, wrong, or past its expiry.
//
// These used to be three different responses — a 404 "No verification code
// found", a 400 "Incorrect code" and a 400 "Verification code expired" — which
// together tell an attacker whether a given address has a signup in progress.
// Combined with the 409 that startSignup used to throw for an existing account,
// that made the signup endpoints a working account-enumeration oracle.
function invalidCodeError() {
  const e = new Error('That code is not valid or has expired. Request a new one and try again.');
  e.status = 400;
  e.code = 'OTP_INVALID';
  return e;
}

// Rows that can never be used again. Cleared opportunistically so the table
// does not grow without bound, and so a consumed code cannot linger as a
// record of who signed up when.
function purgeDeadOtps(email, purpose) {
  prisma.emailOtp.deleteMany({
    where: {
      OR: [
        { email, purpose, consumed: true },
        { expiresAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      ],
    },
  }).catch(() => {});
}

// Claims an OTP row atomically: the writer that flips `consumed` false→true is
// the only one allowed to proceed.
//
// This was a read followed by an unconditional update, so two requests carrying
// the same valid code could both pass the check and both go on to create an
// account — the second only failing later, on the email unique constraint. A
// code is single-use, and this is what makes that true under concurrency.
async function consumeOtp(otpId) {
  const claimed = await prisma.emailOtp.updateMany({
    where: { id: otpId, consumed: false },
    data: { consumed: true },
  });
  return claimed.count === 1;
}

// Counts a wrong guess and locks the code out after MAX_OTP_ATTEMPTS, so a
// six-digit code cannot be walked through at leisure before it expires.
async function registerFailedAttempt(otp) {
  const attempts = otp.attempts + 1;
  await prisma.emailOtp.update({
    where: { id: otp.id },
    data: attempts >= MAX_OTP_ATTEMPTS ? { attempts, consumed: true } : { attempts },
  });
}

// A code that could not be delivered must not be reported as sent.
//
// The row stays in the database either way (so a retry reuses the same window),
// but the caller is told the truth, and the reason names the actual fault
// instead of leaving the user waiting for mail that is never coming.
async function deliverOtpOrThrow(type, { email, name, code }) {
  const result = await sendOtpEmailNow(type, { email, name, code });
  if (result.ok) return;
  const e = new Error(
    'We could not send the verification email just now. '
    + 'Please try again in a moment — if it keeps happening, the mail service needs attention.',
  );
  e.status = 503;
  e.code = 'EMAIL_DELIVERY_FAILED';
  // Deliberate: this message is for the person who just pressed "Sign up", so
  // the error handler must pass it through rather than replacing it with the
  // generic 5xx apology.
  e.expose = true;
  throw e;
}

export async function startSignup({ name, email, password }) {
  const normalizedEmail = String(email).trim().toLowerCase();

  // Enumeration guard: an address that already has an account gets the same
  // response shape and the same latency as one that does not. Instead of a code
  // it receives a note saying the account exists, which is useful to the real
  // owner and tells an attacker nothing they did not already supply.
  //
  // This used to throw 409 "Email already in use", which turned signup into a
  // free lookup service for "does this person have an account here".
  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existing) {
    await deliverOtpOrThrow('signup-exists', { email: normalizedEmail, name: existing.name, code: null });
    return { email: normalizedEmail, message: 'Verification code sent' };
  }

  // Resend cooldown: one code per address per minute, whatever the caller does.
  const recent = await prisma.emailOtp.findFirst({
    where: {
      email: normalizedEmail, purpose: 'SIGNUP', consumed: false,
      createdAt: { gt: new Date(Date.now() - RESEND_COOLDOWN_MS) },
    },
    orderBy: { createdAt: 'desc' },
  });
  if (recent) {
    const e = new Error('A code was just sent — please wait a minute before requesting another.');
    e.status = 429;
    e.code = 'OTP_COOLDOWN';
    throw e;
  }

  // Any earlier pending code for this address stops working the moment a new
  // one is issued, so only the most recent code is ever live.
  await prisma.emailOtp.updateMany({
    where: { email: normalizedEmail, purpose: 'SIGNUP', consumed: false },
    data: { consumed: true },
  });

  const code = generateOtp();
  const passwordHash = await bcrypt.hash(password, env.BCRYPT_SALT_ROUNDS);

  await prisma.emailOtp.create({
    data: {
      email: normalizedEmail, codeHash: hashCode(code), purpose: 'SIGNUP',
      name, passwordHash, expiresAt: new Date(Date.now() + OTP_TTL_MS),
    },
  });
  await deliverOtpOrThrow('signup-otp', { email: normalizedEmail, name, code });
  purgeDeadOtps(normalizedEmail, 'SIGNUP');

  return { email: normalizedEmail, message: 'Verification code sent' };
}

export async function resendSignupOtp({ email }) {
  const normalizedEmail = String(email).trim().toLowerCase();
  const pending = await prisma.emailOtp.findFirst({
    where: { email: normalizedEmail, purpose: 'SIGNUP', consumed: false },
    orderBy: { createdAt: 'desc' },
  });

  // No pending signup is answered exactly as a successful resend would be.
  // Returning 404 here told an attacker which addresses were mid-signup.
  if (!pending) {
    return { email: normalizedEmail, message: 'Verification code re-sent' };
  }
  if (pending.createdAt > new Date(Date.now() - RESEND_COOLDOWN_MS)) {
    const e = new Error('A code was just sent — please wait a minute before requesting another.');
    e.status = 429;
    e.code = 'OTP_COOLDOWN';
    throw e;
  }

  // Issue a fresh code on a new row, carrying over the already-hashed password,
  // and retire the old one so only one code is ever live.
  await prisma.emailOtp.update({ where: { id: pending.id }, data: { consumed: true } });
  const code = generateOtp();
  await prisma.emailOtp.create({
    data: {
      email: normalizedEmail, codeHash: hashCode(code), purpose: 'SIGNUP',
      name: pending.name, passwordHash: pending.passwordHash,
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
    },
  });
  await deliverOtpOrThrow('signup-otp', { email: normalizedEmail, name: pending.name, code });

  return { email: normalizedEmail, message: 'Verification code re-sent' };
}

export async function verifySignup({ email, code, inviteToken }) {
  const normalizedEmail = String(email).trim().toLowerCase();
  const otp = await prisma.emailOtp.findFirst({
    where: { email: normalizedEmail, purpose: 'SIGNUP', consumed: false },
    orderBy: { createdAt: 'desc' },
  });

  // Missing, expired and wrong all answer identically — see invalidCodeError.
  if (!otp) throw invalidCodeError();
  if (otp.expiresAt < new Date()) {
    await consumeOtp(otp.id);
    throw invalidCodeError();
  }

  if (!codeMatches(otp.codeHash, code)) {
    await registerFailedAttempt(otp);
    throw invalidCodeError();
  }

  // Single-use, enforced atomically. A concurrent request carrying the same
  // code loses this race and is told the code is not valid, which it no
  // longer is.
  if (!(await consumeOtp(otp.id))) throw invalidCodeError();

  // Someone may have registered this address (via an invite, or Google) while
  // the code was in flight.
  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existing) {
    const err = new Error('That email is already registered. Sign in instead.');
    err.status = 409;
    throw err;
  }

  const superAdmin = isPlatformAdmin(normalizedEmail);
  // No workspace yet unless an invite is consumed below: the user becomes
  // ADMIN only when they explicitly create one (createWorkspace), or CLIENT
  // when an invite joins them to an existing workspace.
  //
  // The `role` the caller sends is deliberately ignored. It used to be read
  // straight off the request body, which would have let anyone self-assign a
  // role at signup.
  let joined = null;
  let user;
  try {
    user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: { name: otp.name, email: normalizedEmail, passwordHash: otp.passwordHash },
      });
      if (inviteToken) joined = await consumeInvitationAtomically(tx, inviteToken, normalizedEmail, created.id);
      return created;
    });
  } catch (err) {
    rethrowAsDuplicateEmail(err);
  }

  const { accessToken, refreshToken } = generateTokens(user.id, joined?.workspaceId ?? null, joined?.role ?? null, superAdmin);
  await storeRefreshToken(user.id, refreshToken);
  prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }).catch(() => {});
  purgeDeadOtps(normalizedEmail, 'SIGNUP');

  return {
    accessToken, refreshToken,
    user: { id: user.id, name: user.name, email: user.email, role: joined?.role ?? null, superAdmin },
    workspace: joined?.workspace ?? null,
  };
}

// ─── Forgot / reset password ──────────────────────────────────────────────────
// Mirrors the signup OTP flow above: a 6-digit code is emailed and hashed
// into EmailOtp (purpose: 'PASSWORD_RESET'), carrying the *new* password's
// hash so nothing is applied to the User row until the code is verified.
export async function startPasswordReset({ email }) {
  const normalizedEmail = String(email).trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  // Don't reveal whether the email exists — always respond the same way.
  if (!user) return { message: 'If an account exists for this email, a reset code has been sent.' };

  const recent = await prisma.emailOtp.findFirst({
    where: { email: normalizedEmail, purpose: 'PASSWORD_RESET', consumed: false, createdAt: { gt: new Date(Date.now() - RESEND_COOLDOWN_MS) } },
    orderBy: { createdAt: 'desc' },
  });
  if (recent) { const e = new Error('A code was just sent — please wait a minute before requesting another.'); e.status = 429; throw e; }

  await prisma.emailOtp.updateMany({ where: { email: normalizedEmail, purpose: 'PASSWORD_RESET', consumed: false }, data: { consumed: true } });

  const code = generateOtp();
  await prisma.emailOtp.create({
    data: {
      email: normalizedEmail, codeHash: hashCode(code), purpose: 'PASSWORD_RESET',
      name: user.name, expiresAt: new Date(Date.now() + OTP_TTL_MS),
    },
  });
  await deliverOtpOrThrow('password-reset-otp', { email: normalizedEmail, name: user.name, code });

  return { message: 'If an account exists for this email, a reset code has been sent.' };
}

export async function resetPassword({ email, code, newPassword }) {
  const normalizedEmail = String(email).trim().toLowerCase();
  const otp = await prisma.emailOtp.findFirst({
    where: { email: normalizedEmail, purpose: 'PASSWORD_RESET', consumed: false },
    orderBy: { createdAt: 'desc' },
  });

  // Missing, expired and wrong all answer identically, for the same reason the
  // signup path does: distinguishing them tells an attacker which addresses
  // have a reset in progress.
  if (!otp) throw invalidCodeError();
  if (otp.expiresAt < new Date()) {
    await consumeOtp(otp.id);
    throw invalidCodeError();
  }
  if (!codeMatches(otp.codeHash, code)) {
    await registerFailedAttempt(otp);
    throw invalidCodeError();
  }
  // Single-use, enforced atomically — otherwise two requests carrying one code
  // could both go on to reset the password.
  if (!(await consumeOtp(otp.id))) throw invalidCodeError();

  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (!user) { const e = new Error('Account no longer exists'); e.status = 404; throw e; }

  const passwordHash = await bcrypt.hash(newPassword, env.BCRYPT_SALT_ROUNDS);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
  // Invalidate every existing session — a leaked/expired password shouldn't
  // leave old refresh tokens usable after a reset.
  await prisma.refreshToken.deleteMany({ where: { userId: user.id } });

  return { message: 'Password updated — please sign in with your new password.' };
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

// ─── Multi-workspace sessions ──────────────────────────────────────────────────
// A user can belong to more than one workspace (accepted invites), but a
// session's JWT is still scoped to exactly one at a time. These let the
// client re-scope its session to any workspace the user is actually a
// member of, without a full re-login.

// Shared tail of createWorkspace — mint tokens scoped to a given workspace.
// Used by both switchWorkspace and the invitations controller's accept flow.
export async function mintSessionForWorkspace(userId, workspaceId, role) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) { const e = new Error('User not found'); e.status = 404; throw e; }

  const superAdmin = isPlatformAdmin(user.email);
  const { accessToken, refreshToken } = generateTokens(user.id, workspaceId, role, superAdmin);
  await storeRefreshToken(user.id, refreshToken);

  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { id: true, name: true } });

  return {
    accessToken, refreshToken,
    user: { id: user.id, name: user.name, email: user.email, role, superAdmin },
    workspace,
  };
}

export async function switchWorkspace(userId, targetWorkspaceId) {
  const member = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId, workspaceId: targetWorkspaceId } },
  });
  if (!member) { const e = new Error('Not a member of this workspace'); e.status = 403; throw e; }

  return mintSessionForWorkspace(userId, targetWorkspaceId, member.role);
}

// Platform-admin impersonation: mint a session for the target user's default
// (earliest-joined) workspace, exactly as if they'd logged in themselves.
// Impersonating the platform admin account is blocked — no legitimate use,
// and it would silently hand out a super-admin session from a user-id lookup.
export async function impersonateUser(targetUserId) {
  const user = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!user) { const e = new Error('User not found'); e.status = 404; throw e; }
  if (isPlatformAdmin(user.email)) { const e = new Error('Cannot impersonate the platform admin'); e.status = 400; throw e; }

  const member = await prisma.workspaceMember.findFirst({
    where: { userId: targetUserId },
    orderBy: { joinedAt: 'asc' },
  });

  const { accessToken, refreshToken } = generateTokens(user.id, member?.workspaceId ?? null, member?.role ?? null, false);
  await storeRefreshToken(user.id, refreshToken);

  const workspace = member
    ? await prisma.workspace.findUnique({ where: { id: member.workspaceId }, select: { id: true, name: true } })
    : null;

  return {
    accessToken, refreshToken,
    user: { id: user.id, name: user.name, email: user.email, role: member?.role ?? null, superAdmin: false },
    workspace,
  };
}

export async function listMyWorkspaces(userId) {
  const members = await prisma.workspaceMember.findMany({
    where: { userId },
    include: { workspace: { select: { id: true, name: true } } },
    orderBy: { joinedAt: 'asc' },
  });
  return members.map((m) => ({ id: m.workspace.id, name: m.workspace.name, role: m.role, joinedAt: m.joinedAt }));
}
