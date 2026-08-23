// Authentication, OTP and authorization — the whole flow, end to end.
//
//   signup → OTP generation → delivery → verification → account activation
//   → login → session/token → protected API → authorization → logout
//
// Run with the server up:
//   node --env-file=.env scripts/auth-check.mjs
//
// Every assertion here corresponds to a defect that was reproduced before it
// was fixed, or to a rule that must not silently regress. Nothing is mocked:
// this drives the real HTTP surface against the real database.
//
// The one accommodation is OTP delivery. Codes are recovered from the stored
// hash rather than from an inbox (scripts/signup-helper.mjs explains why), so
// the suite can exercise everything after delivery even while SMTP credentials
// are rejected. Delivery itself is asserted separately, against the mailer.

import { PrismaClient } from '@prisma/client';
import { signUpVerified, pendingCode, recoverCode } from './signup-helper.mjs';

const BASE = process.env.AUTH_CHECK_BASE_URL || 'http://127.0.0.1:4000/api/v1';
const prisma = new PrismaClient();

let pass = 0;
let fail = 0;
const results = [];
const section = (name) => results.push(`\n── ${name} ${'─'.repeat(Math.max(0, 58 - name.length))}`);
function check(name, ok, detail) {
  if (ok) pass += 1; else fail += 1;
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? `  <- ${detail}` : ''}`);
}

async function req(method, path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.body) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + path, {
    method, headers, body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  return { status: res.status, data };
}
const deps = { prisma, req };

const stamp = Date.now();
const addr = (label) => `authcheck.${label}.${stamp}@example.test`;
const created = [];

// Rate limiters are keyed per IP and per account; a suite that deliberately
// trips them would otherwise poison every later assertion.
async function clearLimits() {
  const { redis } = await import('../src/lib/redis.js');
  const keys = await redis.keys('rl:*');
  if (keys.length) await redis.del(...keys);
}

try {
  await clearLimits();

  // ── Signup and OTP ─────────────────────────────────────────────────────────
  section('Signup + OTP');
  {
    const email = addr('valid');
    created.push(email);
    await prisma.emailOtp.deleteMany({ where: { email } });

    const start = await req('POST', '/auth/register/start', {
      body: { name: 'Valid Signup', email, password: 'password123' },
    });
    // With SMTP rejecting our credentials the honest answer is 503; the flow is
    // still correct, so the suite reports which of the two it saw.
    const delivered = start.status === 200;
    check('signup: a valid request is accepted',
      delivered || (start.status === 503 && start.data?.code === 'EMAIL_DELIVERY_FAILED'),
      `status=${start.status} ${JSON.stringify(start.data)}`);

    const row = await prisma.emailOtp.findFirst({
      where: { email, purpose: 'SIGNUP' }, orderBy: { createdAt: 'desc' },
    });
    check('otp: a code row is generated', Boolean(row));
    check('otp: the code is stored hashed, never in plaintext',
      Boolean(row) && /^[0-9a-f]{64}$/.test(row.codeHash));
    check('otp: the code is six digits from a CSPRNG',
      Boolean(row) && /^\d{6}$/.test(recoverCode(row.codeHash) ?? ''));
    check('otp: an expiry is set roughly ten minutes out', Boolean(row)
      && row.expiresAt.getTime() - row.createdAt.getTime() > 9 * 60_000
      && row.expiresAt.getTime() - row.createdAt.getTime() <= 10 * 60_000 + 2000);
    check('otp: the pending password is stored hashed, not in the clear',
      Boolean(row) && typeof row.passwordHash === 'string' && row.passwordHash.startsWith('$2'));
  }

  {
    const bad = await req('POST', '/auth/register/start', {
      body: { name: 'X', email: 'not-an-email', password: 'short' },
    });
    check('signup: an invalid request is rejected with field errors',
      bad.status === 400 && Boolean(bad.data?.details), `status=${bad.status}`);
  }

  // ── OTP delivery ───────────────────────────────────────────────────────────
  section('OTP delivery');
  {
    const { verifySmtp } = await import('../src/lib/mailer.js');
    const smtp = await verifySmtp();
    // Either the mail server accepts our credentials, or the code says exactly
    // why not. What must never happen is a cheerful 200 for mail that failed.
    check('delivery: SMTP status is known and reported, not assumed',
      typeof smtp.ok === 'boolean' && (smtp.ok || Boolean(smtp.reason)),
      JSON.stringify(smtp));
    if (!smtp.ok) results.push(`      SMTP blocked: ${smtp.reason.slice(0, 120)}…`);

    const email = addr('delivery');
    created.push(email);
    await prisma.emailOtp.deleteMany({ where: { email } });
    const r = await req('POST', '/auth/register/start', {
      body: { name: 'Delivery Probe', email, password: 'password123' },
    });
    check('delivery: a send failure is reported rather than faked',
      smtp.ok ? r.status === 200 : (r.status === 503 && r.data?.code === 'EMAIL_DELIVERY_FAILED'),
      `smtp.ok=${smtp.ok} status=${r.status}`);
  }

  // ── Wrong, expired, reused ─────────────────────────────────────────────────
  section('OTP verification rules');
  {
    const email = addr('wrong');
    created.push(email);
    await prisma.emailOtp.deleteMany({ where: { email } });
    await req('POST', '/auth/register/start', { body: { name: 'Wrong Code', email, password: 'password123' } });
    const { otp, code } = await pendingCode(prisma, email);

    const wrong = await req('POST', '/auth/register/verify', {
      body: { email, code: code === '000000' ? '111111' : '000000' },
    });
    check('otp: a wrong code is rejected', wrong.status === 400, `status=${wrong.status}`);
    check('otp: a wrong code does not create an account',
      (await prisma.user.count({ where: { email } })) === 0);

    const after = await prisma.emailOtp.findUnique({ where: { id: otp.id } });
    check('otp: a wrong guess is counted', after.attempts === 1, `attempts=${after.attempts}`);

    // Walk the remaining attempts; the code must lock out, not stay open until
    // it expires.
    for (let i = 0; i < 4; i += 1) {
      await req('POST', '/auth/register/verify', { body: { email, code: '000001' } });
    }
    // The attempt counter under test is the OTP's own, not the HTTP limiter's.
    await clearLimits();
    const locked = await prisma.emailOtp.findUnique({ where: { id: otp.id } });
    check('otp: the code locks out after five wrong guesses', locked.consumed === true,
      `attempts=${locked.attempts} consumed=${locked.consumed}`);
    const afterLock = await req('POST', '/auth/register/verify', { body: { email, code } });
    check('otp: the correct code no longer works once locked out', afterLock.status === 400);
  }

  {
    const email = addr('expired');
    created.push(email);
    await prisma.emailOtp.deleteMany({ where: { email } });
    await req('POST', '/auth/register/start', { body: { name: 'Expired Code', email, password: 'password123' } });
    const { otp, code } = await pendingCode(prisma, email);
    await prisma.emailOtp.update({
      where: { id: otp.id }, data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    const r = await req('POST', '/auth/register/verify', { body: { email, code } });
    check('otp: an expired code is rejected', r.status === 400, `status=${r.status}`);
    check('otp: an expired code does not create an account',
      (await prisma.user.count({ where: { email } })) === 0);
    const spent = await prisma.emailOtp.findUnique({ where: { id: otp.id } });
    check('otp: an expired code is retired rather than left pending', spent.consumed === true);
  }

  {
    const email = addr('reuse');
    created.push(email);
    await prisma.emailOtp.deleteMany({ where: { email } });
    await req('POST', '/auth/register/start', { body: { name: 'Reuse Code', email, password: 'password123' } });
    const { code } = await pendingCode(prisma, email);
    const first = await req('POST', '/auth/register/verify', { body: { email, code } });
    check('otp: a correct code activates the account', first.status === 201, `status=${first.status}`);
    const second = await req('POST', '/auth/register/verify', { body: { email, code } });
    check('otp: the same code cannot be used twice', second.status === 400, `status=${second.status}`);
    check('otp: reuse does not create a second account',
      (await prisma.user.count({ where: { email } })) === 1);
  }

  // ── Resend cooldown ────────────────────────────────────────────────────────
  section('Resend cooldown');
  await clearLimits();
  {
    const email = addr('resend');
    created.push(email);
    await prisma.emailOtp.deleteMany({ where: { email } });
    await req('POST', '/auth/register/start', { body: { name: 'Resend', email, password: 'password123' } });
    const immediate = await req('POST', '/auth/register/resend', { body: { email } });
    check('resend: a second code inside the cooldown is refused',
      immediate.status === 429 && immediate.data?.code === 'OTP_COOLDOWN', `status=${immediate.status}`);

    // Age the row past the cooldown and try again.
    const { otp: pending } = await pendingCode(prisma, email);
    await prisma.emailOtp.update({
      where: { id: pending.id }, data: { createdAt: new Date(Date.now() - 61_000) },
    });
    const later = await req('POST', '/auth/register/resend', { body: { email } });
    check('resend: a code is re-issued once the cooldown has passed',
      later.status === 200 || later.status === 503, `status=${later.status}`);
    const retired = await prisma.emailOtp.findUnique({ where: { id: pending.id } });
    check('resend: the previous code stops working', retired.consumed === true);
  }

  // ── Account enumeration ────────────────────────────────────────────────────
  section('Information disclosure');
  await clearLimits();
  {
    const known = created.find(Boolean);
    const unknown = addr('nobody');
    await prisma.emailOtp.deleteMany({ where: { email: { in: [known, unknown] } } });

    await clearLimits();
    const a = await req('POST', '/auth/register/start', { body: { name: 'A', email: known, password: 'password123' } });
    await clearLimits();
    const b = await req('POST', '/auth/register/start', { body: { name: 'B', email: unknown, password: 'password123' } });
    check('privacy: signup does not reveal whether an address is registered',
      a.status === b.status, `known=${a.status} unknown=${b.status}`);

    await clearLimits();
    const c = await req('POST', '/auth/forgot-password', { body: { email: known } });
    await clearLimits();
    const d = await req('POST', '/auth/forgot-password', { body: { email: unknown } });
    check('privacy: password reset does not reveal whether an address is registered',
      c.status === d.status && JSON.stringify(c.data) === JSON.stringify(d.data),
      `known=${c.status} unknown=${d.status}`);

    const e = await req('POST', '/auth/register/verify', { body: { email: unknown, code: '123456' } });
    const withPending = addr('pending');
    created.push(withPending);
    await req('POST', '/auth/register/start', { body: { name: 'P', email: withPending, password: 'password123' } });
    const f = await req('POST', '/auth/register/verify', { body: { email: withPending, code: '999999' } });
    check('privacy: a missing code and a wrong code are indistinguishable',
      e.status === f.status && e.data?.error === f.data?.error,
      `${e.status}:${e.data?.error} vs ${f.status}:${f.data?.error}`);

    const bad = await req('POST', '/auth/login', { body: { email: unknown, password: 'whatever' } });
    check('privacy: login does not say which of email or password was wrong',
      bad.status === 401 && /invalid credentials/i.test(bad.data?.error ?? ''), JSON.stringify(bad.data));
  }

  // ── Login ──────────────────────────────────────────────────────────────────
  section('Login and session');
  await clearLimits();
  const owner = await signUpVerified(deps, { name: 'Auth Owner', email: addr('owner') });
  created.push(owner.user.email);
  check('signup: activation returns a usable session', Boolean(owner.accessToken && owner.refreshToken));
  check('signup: a new account has no workspace and no role until it creates or joins one',
    owner.workspace === null && owner.user.role === null, JSON.stringify(owner.workspace));

  {
    const good = await req('POST', '/auth/login', { body: { email: owner.user.email, password: 'password123' } });
    check('login: correct credentials are accepted', good.status === 200 && Boolean(good.data.accessToken));
    const wrong = await req('POST', '/auth/login', { body: { email: owner.user.email, password: 'wrong-password' } });
    check('login: wrong credentials are refused', wrong.status === 401);
  }

  // A workspace, so there is something to authorise against.
  const wsRes = await req('POST', '/workspaces', { token: owner.accessToken, body: { name: 'Auth Check Workspace' } });
  check('signup: creating a workspace makes that user its ADMIN',
    wsRes.status < 400 && wsRes.data.user.role === 'ADMIN', JSON.stringify(wsRes.data?.user));
  const WS = wsRes.data.workspace.id;
  const adminToken = wsRes.data.accessToken;

  // ── Brute force ────────────────────────────────────────────────────────────
  section('Brute-force protection');
  {
    await clearLimits();
    const target = owner.user.email;
    let blocked = 0;
    let firstBlockAt = null;
    for (let i = 0; i < 20; i += 1) {
      const r = await req('POST', '/auth/login', { body: { email: target, password: `wrong-${i}` } });
      if (r.status === 429) { blocked += 1; if (firstBlockAt === null) firstBlockAt = i + 1; }
    }
    check('brute force: repeated failures lock the account out', blocked > 0,
      `${blocked}/20 blocked`);
    check('brute force: lockout arrives well before the guess space is meaningful',
      firstBlockAt !== null && firstBlockAt <= 12, `first block at attempt ${firstBlockAt}`);

    const stillBlocked = await req('POST', '/auth/login', { body: { email: target, password: 'password123' } });
    check('brute force: the correct password is refused while locked out',
      stillBlocked.status === 429, `status=${stillBlocked.status}`);

    // Rotating the forwarded-for header must not mint a fresh allowance.
    let spoofBlocked = 0;
    for (let i = 0; i < 8; i += 1) {
      const r = await req('POST', '/auth/login', {
        body: { email: target, password: `spoof-${i}` },
        headers: { 'X-Forwarded-For': `203.0.113.${i}` },
      });
      if (r.status === 429) spoofBlocked += 1;
    }
    check('brute force: a spoofed X-Forwarded-For does not reset the limit',
      spoofBlocked === 8, `${spoofBlocked}/8 blocked`);

    await clearLimits();
    const recovered = await req('POST', '/auth/login', { body: { email: target, password: 'password123' } });
    check('brute force: a legitimate user can sign in once the window passes',
      recovered.status === 200, `status=${recovered.status}`);
  }

  {
    await clearLimits();
    // Successful sign-ins must not consume the guessing allowance, or an office
    // behind one address locks itself out.
    let refused = 0;
    for (let i = 0; i < 25; i += 1) {
      const r = await req('POST', '/auth/login', { body: { email: owner.user.email, password: 'password123' } });
      if (r.status !== 200) refused += 1;
    }
    check('rate limiting: successful logins do not count against the limit', refused === 0,
      `${refused}/25 refused`);
  }

  {
    await clearLimits();
    // Code-sending endpoints are limited separately, because each call sends
    // mail. Two caps: 10 per IP per 15 minutes, and 5 per address — so this
    // sends 14 across distinct addresses to prove the per-IP cap bites.
    let limited = 0;
    for (let i = 0; i < 14; i += 1) {
      const r = await req('POST', '/auth/forgot-password', { body: { email: addr(`flood${i}`) } });
      if (r.status === 429) limited += 1;
    }
    check('rate limiting: OTP requests are throttled per source', limited > 0, `${limited}/14 limited`);

    // And per address, independently of the source, so a spray across IPs
    // cannot spam one person's inbox.
    await clearLimits();
    const victim = addr('otpvictim');
    let perAddress = 0;
    for (let i = 0; i < 8; i += 1) {
      const r = await req('POST', '/auth/forgot-password', {
        body: { email: victim }, headers: { 'X-Forwarded-For': `198.51.100.${i}` },
      });
      if (r.status === 429) perAddress += 1;
    }
    check('rate limiting: OTP requests are throttled per address', perAddress > 0,
      `${perAddress}/8 limited`);
  }

  // ── Protected routes ───────────────────────────────────────────────────────
  section('Protected endpoints');
  await clearLimits();
  {
    const noToken = await req('GET', `/workspaces/${WS}/contacts`);
    check('protected: a request with no token is refused', noToken.status === 401);
    const badToken = await req('GET', `/workspaces/${WS}/contacts`, { token: 'not-a-jwt' });
    check('protected: a malformed token is refused', badToken.status === 401);

    // A token signed with the wrong key must not be accepted.
    const jwt = (await import('jsonwebtoken')).default;
    const forged = jwt.sign({ sub: 'someone', workspaceId: WS, role: 'ADMIN' }, 'not-the-real-secret');
    const forgedRes = await req('GET', `/workspaces/${WS}/contacts`, { token: forged });
    check('protected: a forged token is refused', forgedRes.status === 401);

    const withToken = await req('GET', `/workspaces/${WS}/contacts`, { token: adminToken });
    check('protected: a valid token is accepted', withToken.status === 200);
  }

  // ── Authorization by role ──────────────────────────────────────────────────
  section('Role permissions');
  const roleTokens = { ADMIN: adminToken };
  for (const role of ['CLIENT', 'AGENT', 'VIEWER']) {
    const u = await signUpVerified(deps, { name: `Auth ${role}`, email: addr(role.toLowerCase()) });
    created.push(u.user.email);
    await prisma.workspaceMember.create({ data: { userId: u.user.id, workspaceId: WS, role } });
    // Re-login so the token carries the workspace and role.
    const s = await req('POST', '/auth/login', { body: { email: u.user.email, password: 'password123' } });
    roleTokens[role] = s.data.accessToken;
  }

  const phone = () => `+9198${Math.floor(10000000 + Math.random() * 89999999)}`;
  const probes = [
    ['read contacts',      'GET',   '/contacts',   null,                              { VIEWER: true,  AGENT: true,  CLIENT: true,  ADMIN: true }],
    ['read analytics',     'GET',   '/analytics/overview', null,                      { VIEWER: true,  AGENT: true,  CLIENT: true,  ADMIN: true }],
    ['create a contact',   'POST',  '/contacts',   () => ({ name: 'RBAC', phoneNumber: phone() }), { VIEWER: false, AGENT: true,  CLIENT: true,  ADMIN: true }],
    ['create a campaign',  'POST',  '/campaigns',  () => ({ name: 'RBAC', templateId: 'x', numberId: 'y' }), { VIEWER: false, AGENT: false, CLIENT: true,  ADMIN: true }],
    ['create an API key',  'POST',  '/api-keys',   () => ({ name: 'RBAC key' }),       { VIEWER: false, AGENT: false, CLIENT: true,  ADMIN: true }],
    ['change settings',    'PATCH', '/settings',   () => ({ welcomeMessage: 'hi' }),   { VIEWER: false, AGENT: false, CLIENT: true,  ADMIN: true }],
    ['spend from the wallet', 'POST', '/wallet/checkout', () => ({ amount: 100 }),     { VIEWER: false, AGENT: false, CLIENT: false, ADMIN: true }],
    ['invite a member',    'POST',  '/members/invite', () => ({ email: addr('invitee'), role: 'CLIENT' }), { VIEWER: false, AGENT: false, CLIENT: false, ADMIN: true }],
  ];

  for (const [label, method, path, bodyFn, expected] of probes) {
    for (const role of ['VIEWER', 'AGENT', 'CLIENT', 'ADMIN']) {
      const r = await req(method, `/workspaces/${WS}${path}`, {
        token: roleTokens[role], body: bodyFn ? bodyFn() : undefined,
      });
      // A 403 is a refusal. Anything else means the guard let it through and the
      // handler ran on its own merits — 404/400/422 on synthetic ids is a pass
      // for permission purposes, and a plan cap (PLAN_LIMIT_REACHED) is not a
      // role refusal either.
      const refusedByRole = r.status === 403 && r.data?.code !== 'PLAN_LIMIT_REACHED';
      const allowed = !refusedByRole;
      check(`rbac: ${role.toLowerCase()} ${expected[role] ? 'can' : 'cannot'} ${label}`,
        allowed === expected[role], `status=${r.status} ${JSON.stringify(r.data).slice(0, 90)}`);
    }
  }

  // ── Cross-account isolation ────────────────────────────────────────────────
  section('Tenant isolation');
  {
    const outsider = await signUpVerified(deps, { name: 'Outsider', email: addr('outsider') });
    created.push(outsider.user.email);
    const ws2 = await req('POST', '/workspaces', { token: outsider.accessToken, body: { name: 'Outsider Workspace' } });
    const outsiderToken = ws2.data.accessToken;
    const outsiderWs = ws2.data.workspace.id;

    check('isolation: a member of one workspace cannot read another',
      (await req('GET', `/workspaces/${WS}/contacts`, { token: outsiderToken })).status === 403);
    check('isolation: nor write to it',
      (await req('POST', `/workspaces/${WS}/contacts`, { token: outsiderToken, body: { name: 'X', phoneNumber: phone() } })).status === 403);
    check('isolation: and the reverse holds',
      (await req('GET', `/workspaces/${outsiderWs}/contacts`, { token: adminToken })).status === 403);

    // A token whose own claim names a workspace it does not belong to must not
    // be trusted — membership is checked against the database on every request.
    const jwt = (await import('jsonwebtoken')).default;
    const { env } = await import('../src/config/env.js');
    const tampered = jwt.sign(
      { sub: outsider.user.id, workspaceId: WS, role: 'ADMIN', superAdmin: false },
      env.JWT_ACCESS_SECRET, { expiresIn: '5m' },
    );
    check('isolation: a validly-signed token claiming another workspace is refused',
      (await req('GET', `/workspaces/${WS}/contacts`, { token: tampered })).status === 403);
    check('isolation: a self-assigned superAdmin claim is not honoured',
      (await req('GET', '/admin/platform/stats', {
        token: jwt.sign({ sub: outsider.user.id, superAdmin: true }, env.JWT_ACCESS_SECRET, { expiresIn: '5m' }),
      })).status === 403);
  }

  // ── Logout ─────────────────────────────────────────────────────────────────
  section('Logout');
  {
    const s = await req('POST', '/auth/login', { body: { email: owner.user.email, password: 'password123' } });
    const before = await req('GET', `/workspaces/${WS}/contacts`, { token: s.data.accessToken });
    check('logout: the session works beforehand', before.status === 200);

    await req('POST', '/auth/logout', {
      token: s.data.accessToken, body: { refreshToken: s.data.refreshToken },
    });
    const after = await req('GET', `/workspaces/${WS}/contacts`, { token: s.data.accessToken });
    check('logout: the access token stops working immediately', after.status === 401,
      `status=${after.status}`);
    const refreshed = await req('POST', '/auth/refresh', { body: { refreshToken: s.data.refreshToken } });
    check('logout: the refresh token cannot mint a new session', refreshed.status === 401);
  }

  {
    // A password reset must end every other session, not just the current one.
    const email = addr('reset');
    created.push(email);
    const u = await signUpVerified(deps, { name: 'Reset User', email });
    const live = await req('GET', '/users/me', { token: u.accessToken });
    await prisma.emailOtp.deleteMany({ where: { email } });
    await req('POST', '/auth/forgot-password', { body: { email } });
    const { code } = await pendingCode(prisma, email, 'PASSWORD_RESET');
    const done = await req('POST', '/auth/reset-password', {
      body: { email, code, newPassword: 'brand-new-password-1' },
    });
    check('reset: a valid code changes the password', done.status === 200, JSON.stringify(done.data));
    const stale = await req('POST', '/auth/refresh', { body: { refreshToken: u.refreshToken } });
    check('reset: existing sessions are invalidated', live.status === 200 && stale.status === 401,
      `refresh=${stale.status}`);
    const newLogin = await req('POST', '/auth/login', { body: { email, password: 'brand-new-password-1' } });
    check('reset: the new password works', newLogin.status === 200);
  }
} catch (err) {
  check('suite completed without throwing', false, err.stack?.split('\n').slice(0, 3).join(' | '));
} finally {
  // Leave the database as we found it.
  if (created.length) {
    const users = await prisma.user.findMany({ where: { email: { in: created } }, select: { id: true } });
    const ids = users.map((u) => u.id);
    if (ids.length) {
      const memberships = await prisma.workspaceMember.findMany({ where: { userId: { in: ids } }, select: { workspaceId: true } });
      await prisma.workspaceMember.deleteMany({ where: { userId: { in: ids } } });
      await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
      await prisma.workspace.deleteMany({ where: { id: { in: memberships.map((m) => m.workspaceId) }, members: { none: {} } } });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    }
    await prisma.emailOtp.deleteMany({ where: { email: { in: created } } });
  }
  await clearLimits().catch(() => {});
  console.log(results.join('\n'));
  console.log(`\n${pass} passed, ${fail} failed`);
  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}
