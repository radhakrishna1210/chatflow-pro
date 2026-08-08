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

export async function sendMail({ to, subject, html }) {
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASSWORD) {
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
