import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

let _transporter = null;
let _transporterKey = null;

function getTransporter() {
  // Rebuilt when any part of the SMTP configuration changes, so credentials
  // edited from the admin screen do not keep failing against a pooled
  // connection opened with the old ones.
  const cacheKey = [env.SMTP_HOST, env.SMTP_PORT, env.SMTP_SECURE, env.SMTP_IP_FAMILY, env.SMTP_USER, env.SMTP_PASSWORD].join('|');
  if (!_transporter || _transporterKey !== cacheKey) {
    _transporterKey = cacheKey;
    _transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      // Without this the connection goes to whichever address DNS returns
      // first, which for smtp.gmail.com is IPv6 — and on a host with no IPv6
      // route every send dies as `connect ENETUNREACH 2607:f8b0:...:587`
      // (or times out) long before the credentials are ever offered.
      ...(env.SMTP_IP_FAMILY ? { family: env.SMTP_IP_FAMILY } : {}),
      auth: {
        user: env.SMTP_USER,
        pass: env.SMTP_PASSWORD,
      },
    });
  }
  return _transporter;
}

// Opens a connection and authenticates, without sending anything.
//
// Every transactional email — signup OTPs above all — is queued and sent by a
// worker, so a rejected login shows up in a worker log and nowhere else. The
// user just never receives a code. This is what lets the admin screen and the
// health endpoint say "SMTP is refusing our credentials" instead.
export async function verifySmtp() {
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASSWORD) {
    return { ok: false, reason: 'SMTP is not configured (SMTP_HOST, SMTP_USER and SMTP_PASSWORD are all required).' };
  }
  try {
    await getTransporter().verify();
    return { ok: true };
  } catch (err) {
    // Gmail's 535 is by far the most common, and its own text does not mention
    // the actual fix, so name it.
    const isAuth = /535|invalid login|authentication|credentials/i.test(err.message || '');
    return {
      ok: false,
      reason: isAuth
        ? `The mail server rejected the credentials (${err.message.split('\n')[0]}). For Gmail this must be a 16-character App Password from Google Account → Security → App passwords, with 2-Step Verification switched on — a normal account password will always be refused.`
        : `Could not reach the mail server: ${err.message}`,
    };
  }
}

// `mustDeliver` marks an email the user is actively waiting for (a verification
// code). For those, "SMTP is not configured" must be an error rather than a
// silent skip — otherwise the caller reports success for a code that was never
// going to be sent.
export async function sendMail({ to, subject, html, mustDeliver = false }) {
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASSWORD) {
    if (mustDeliver) {
      throw new Error('Email delivery is not configured on this server (SMTP_HOST, SMTP_USER and SMTP_PASSWORD).');
    }
    console.warn(`[Email] SMTP not configured — skipping email to ${to}: "${subject}"`);
    return;
  }
  try {
    const transporter = getTransporter();
    const info = await transporter.sendMail({
      from: `"${env.EMAIL_FROM_NAME}" <${env.EMAIL_FROM}>`,
      to,
      subject,
      html,
    });
    console.log(`[Email] Sent "${subject}" to ${to} — messageId: ${info.messageId}`);
    return info;
  } catch (err) {
    console.error(`[Email] Failed to send "${subject}" to ${to}:`, err.message);
    throw err;
  }
}
