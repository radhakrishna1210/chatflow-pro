import twilio from 'twilio';
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import { sendMail } from '../lib/mailer.js';
import { debit, credit } from './wallet.service.js';
import { isOptedOut } from './optout.service.js';
import { SMS_FALLBACK_RATE } from '../lib/messagePricing.js';

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
let _twilioSid = null;
let _twilioToken = null;
function twilioClient() {
  const sid = env.TWILIO_ACCOUNT_SID;
  const token = env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;
  if (!_twilio || _twilioSid !== sid || _twilioToken !== token) {
    _twilio = twilio(sid, token);
    _twilioSid = sid;
    _twilioToken = token;
  }
  return _twilio;
}

export function fallbackCapabilities() {
  return {
    sms: !!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN),
    smsRate: SMS_FALLBACK_RATE,
    email: !!env.SMTP_HOST,
  };
}

// Substitute {{1}} → contact name, {{name}} → contact name in fallback copy.
function renderText(template, contact) {
  return String(template || '')
    .replaceAll('{{1}}', contact.name || 'there')
    .replaceAll('{{name}}', contact.name || 'there');
}

// SMS goes out on the platform's Twilio account, so each one is charged to
// the workspace wallet at SMS_FALLBACK_RATE — debited before the send (keyed
// per recipient, so a duplicate fallback can never charge twice) and handed
// back if Twilio refuses it. No balance, no SMS.
async function sendSmsFallback(config, contact, { workspaceId, campaign, recipient }) {
  const client = twilioClient();
  if (!client) return { ok: false, channel: 'sms', reason: 'Twilio not configured' };
  if (!config.smsFrom) return { ok: false, channel: 'sms', reason: 'No SMS sender number configured' };

  const chargeKey = `sms_fallback_${recipient.id}`;
  const charge = await debit(workspaceId, SMS_FALLBACK_RATE, {
    reason: `Fallback SMS: ${campaign.name}`,
    reference: campaign.id,
    category: 'USAGE',
    idempotencyKey: chargeKey,
  }).catch((err) => ({ ok: false, reason: err.message }));
  if (!charge.ok) return { ok: false, channel: 'sms', reason: 'Insufficient wallet balance for SMS' };
  if (charge.alreadyProcessed) return { ok: false, channel: 'sms', reason: 'SMS fallback already sent for this recipient' };

  try {
    const msg = await client.messages.create({
      from: config.smsFrom,
      to: contact.phoneNumber,
      body: renderText(config.smsText || 'We tried to reach you on WhatsApp.', contact).slice(0, 1500),
    });
    return { ok: true, channel: 'sms', sid: msg.sid, charged: SMS_FALLBACK_RATE };
  } catch (err) {
    await credit(workspaceId, SMS_FALLBACK_RATE, {
      reason: `Refund for unsent fallback SMS: ${campaign.name}`,
      reference: campaign.id,
      category: 'REFUND',
      gateway: 'system',
      idempotencyKey: `${chargeKey}_refund`,
    }).catch((e) => console.error(`[Fallback] SMS refund failed for ${recipient.id}:`, e.message));
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

  const workspaceId = campaign.workspaceId;
  // The WhatsApp opt-out was checked before the WhatsApp attempt, but a STOP
  // can land in between — and a customer who opted out has not asked to be
  // reached on another channel instead.
  const attempts = [];
  if (contact?.phoneNumber && await isOptedOut(workspaceId, contact.phoneNumber)) {
    attempts.push({ ok: false, channel: 'all', reason: 'recipient opted out' });
  } else {
    if (config.smsEnabled) attempts.push(await sendSmsFallback(config, contact, { workspaceId, campaign, recipient }));
    if (config.emailEnabled) attempts.push(await sendEmailFallback(config, contact));
  }

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
