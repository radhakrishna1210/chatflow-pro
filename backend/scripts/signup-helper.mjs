// Creating a test account through the real, verified signup flow.
//
// `POST /auth/register` used to create a usable account straight from the
// request body with no email verification, and every test suite bootstrapped
// itself through it. That endpoint is gone — it made the OTP flow optional for
// anyone who skipped the UI — so tests go the way real users do: request a
// code, read it, verify it.
//
// The code is read back out of the EmailOtp row rather than from an inbox. That
// is not a shortcut around the check: the row only exists because startSignup
// created it, verification still runs the full comparison, and the same
// single-use and expiry rules apply. It just means the suite does not need a
// working mail server to exercise everything after delivery.

import { createHash } from 'crypto';

const hashCode = (code) => createHash('sha256').update(String(code)).digest('hex');

// Six digits is a small enough space to search directly, which keeps this
// honest: we never read a plaintext code out of the database, because none is
// stored there. We recover it the only way anyone could — by matching the hash.
export function recoverCode(codeHash) {
  for (let n = 100000; n < 1000000; n += 1) {
    if (hashCode(String(n)) === codeHash) return String(n);
  }
  return null;
}

/**
 * Runs signup end to end and returns the session, or throws with the reason.
 *
 * @param {object} deps  { prisma, req } — `req(method, path, opts)` as the
 *                       suite defines it, returning { status, data }.
 */
export async function signUpVerified(deps, { name, email, password = 'password123', inviteToken } = {}) {
  const { prisma, req } = deps;
  const normalized = String(email).trim().toLowerCase();

  // Any leftover state from a previous run would trip the resend cooldown.
  await prisma.emailOtp.deleteMany({ where: { email: normalized } });

  const start = await req('POST', '/auth/register/start', { body: { name, email: normalized, password } });
  // 503 EMAIL_DELIVERY_FAILED means the code was generated and stored but the
  // mail server refused it. That is a real, separately-asserted condition — it
  // must not stop the suite from exercising everything downstream of delivery,
  // or a broken SMTP credential would leave signup, login, roles and logout
  // entirely untested.
  const deliveryBlocked = start.status === 503 && start.data?.code === 'EMAIL_DELIVERY_FAILED';
  if (start.status !== 200 && !deliveryBlocked) {
    throw new Error(`signup start failed (${start.status}): ${start.data?.error ?? ''}`);
  }

  const otp = await prisma.emailOtp.findFirst({
    where: { email: normalized, purpose: 'SIGNUP', consumed: false },
    orderBy: { createdAt: 'desc' },
  });
  if (!otp) throw new Error(`no verification code was created for ${normalized}`);

  const code = recoverCode(otp.codeHash);
  if (!code) throw new Error('could not recover the verification code from its hash');

  const verify = await req('POST', '/auth/register/verify', {
    body: { email: normalized, code, ...(inviteToken ? { inviteToken } : {}) },
  });
  if (verify.status !== 201) {
    throw new Error(`signup verify failed (${verify.status}): ${verify.data?.error ?? ''}`);
  }
  return verify.data;
}

// The pending code for an address, for tests that need to drive verification
// themselves (wrong code, expiry, reuse).
export async function pendingCode(prisma, email, purpose = 'SIGNUP') {
  const otp = await prisma.emailOtp.findFirst({
    where: { email: String(email).trim().toLowerCase(), purpose, consumed: false },
    orderBy: { createdAt: 'desc' },
  });
  return otp ? { otp, code: recoverCode(otp.codeHash) } : { otp: null, code: null };
}
