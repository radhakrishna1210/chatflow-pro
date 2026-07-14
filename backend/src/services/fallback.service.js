import twilio from 'twilio';
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import { sendMail } from '../lib/mailer.js';

// ─────────────────────────────────────────────────────────────────────────────
// Campaign fallback channels (wizard step 8)
//
// When a WhatsApp send FAILS for a recipient, the campaign's fallbackConfig can
// route the message through alternate channels:
//   { smsEnabled, smsFrom, smsText, emailEnabled, emailSubject, emailText }
// SMS goes via Twilio (credentials from env); email via the existing SMTP
// mailer. Each attempt is recorded on the recipient's failReason so the UI can
// show exactly what happened — no silent or fake successes.
// ─────────────────────────────────────────────────────────────────────────────

let _twilio = null;
function twilioClient() {
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) return null;
  if (!_twilio) _twilio = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
  return _twilio;
}

export function fallbackCapabilities() {
  return {
    sms: !!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN),
    email: !!env.SMTP_HOST,
  };
}

// Substitute {{1}} → contact name, {{name}} → contact name in fallback copy.
function renderText(template, contact) {
  return String(template || '')
    .replaceAll('{{1}}', contact.name || 'there')
    .replaceAll('{{name}}', contact.name || 'there');
}

async function sendSmsFallback(config, contact) {
  const client = twilioClient();
  if (!client) return { ok: false, channel: 'sms', reason: 'Twilio not configured' };
  if (!config.smsFrom) return { ok: false, channel: 'sms', reason: 'No SMS sender number configured' };
  try {
    const msg = await client.messages.create({
      from: config.smsFrom,
      to: contact.phoneNumber,
      body: renderText(config.smsText || 'We tried to reach you on WhatsApp.', contact).slice(0, 1500),
    });
    return { ok: true, channel: 'sms', sid: msg.sid };
  } catch (err) {
    return { ok: false, channel: 'sms', reason: err.message };
  }
}

async function sendEmailFallback(config, contact) {
  if (!env.SMTP_HOST) return { ok: false, channel: 'email', reason: 'SMTP not configured' };
  if (!contact.email) return { ok: false, channel: 'email', reason: 'Contact has no email address' };
  try {
    const text = renderText(config.emailText || 'We tried to reach you on WhatsApp.', contact);
    await sendMail({
      to: contact.email,
      subject: (config.emailSubject || 'A message from us').slice(0, 200),
      html: `<p style="font-family:sans-serif;font-size:14px;line-height:1.6;">${text.replace(/\n/g, '<br/>')}</p>`,
    });
    return { ok: true, channel: 'email' };
  } catch (err) {
    return { ok: false, channel: 'email', reason: err.message };
  }
}

// Called by the campaign worker after a WhatsApp send fails. Attempts the
// enabled channels in order (SMS first, then email), records the outcome on
// the recipient, and returns the attempt log.
export async function runFallbackForRecipient(campaign, recipient, contact) {
  const config = campaign.fallbackConfig;
  if (!config || (!config.smsEnabled && !config.emailEnabled)) return null;

  const attempts = [];
  if (config.smsEnabled) attempts.push(await sendSmsFallback(config, contact));
  if (config.emailEnabled) attempts.push(await sendEmailFallback(config, contact));

  const succeeded = attempts.filter((a) => a.ok).map((a) => a.channel);
  const failed = attempts.filter((a) => !a.ok).map((a) => `${a.channel}: ${a.reason}`);

  const summary = [
    succeeded.length ? `fallback sent via ${succeeded.join('+')}` : null,
    failed.length ? `fallback failed (${failed.join('; ')})` : null,
  ].filter(Boolean).join('; ');

  if (summary) {
    const existing = await prisma.campaignRecipient.findUnique({
      where: { id: recipient.id }, select: { failReason: true },
    });
    await prisma.campaignRecipient.update({
      where: { id: recipient.id },
      data: { failReason: [existing?.failReason, summary].filter(Boolean).join(' | ').slice(0, 500) },
    }).catch(() => {});
  }

  return { attempts, succeeded, failed };
}
