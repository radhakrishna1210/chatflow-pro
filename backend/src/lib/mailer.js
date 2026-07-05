import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

let _transporter = null;

function getTransporter() {
  if (!_transporter) {
    _transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
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
