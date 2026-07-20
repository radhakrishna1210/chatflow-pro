import { prisma } from '../lib/prisma.js';
import { emailQueue } from '../queues/email.queue.js';
import { env } from '../config/env.js';

// ---------------------------------------------------------------------------
// HTML layout
// ---------------------------------------------------------------------------

function layout(content) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;">

          <!-- Header -->
          <tr>
            <td style="background:#0f172a;border-radius:12px 12px 0 0;padding:28px 40px;text-align:center;">
              <p style="margin:0;color:#ffffff;font-size:20px;font-weight:700;letter-spacing:-0.3px;">ChatFlow Pro</p>
              <p style="margin:4px 0 0;color:#94a3b8;font-size:12px;">WhatsApp Business Platform</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="background:#ffffff;padding:40px;">
              ${content}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f8fafc;border-radius:0 0 12px 12px;padding:20px 40px;text-align:center;border-top:1px solid #e2e8f0;">
              <p style="margin:0;color:#94a3b8;font-size:12px;">© ${new Date().getFullYear()} ChatFlow Pro. All rights reserved.</p>
              <p style="margin:6px 0 0;color:#cbd5e1;font-size:11px;">You received this because you have an account on ChatFlow Pro.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// Names (user display name, workspace name, inviter name, …) are all
// user-controlled and end up interpolated straight into these HTML email
// bodies — without escaping, a name like `<img src=x onerror=...>` becomes a
// stored XSS payload delivered to every recipient's inbox.
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function btn(text, url) {
  return `<div style="text-align:center;margin-top:32px;">
    <a href="${url}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;padding:13px 30px;border-radius:8px;font-size:14px;font-weight:600;">${text}</a>
  </div>`;
}

function badge(text, bg, color) {
  return `<span style="display:inline-block;background:${bg};color:${color};font-size:12px;font-weight:600;padding:4px 10px;border-radius:20px;">${text}</span>`;
}

function statRow(label, value) {
  return `<tr>
    <td style="padding:10px 0;border-bottom:1px solid #f1f5f9;color:#64748b;font-size:13px;">${label}</td>
    <td style="padding:10px 0;border-bottom:1px solid #f1f5f9;color:#0f172a;font-size:13px;font-weight:600;text-align:right;">${value}</td>
  </tr>`;
}

// ---------------------------------------------------------------------------
// Template builders
// ---------------------------------------------------------------------------

function welcomeHtml({ name }) {
  const appUrl = env.APP_URL || '#';
  return layout(`
    <h2 style="margin:0 0 8px;color:#0f172a;font-size:22px;font-weight:700;">Welcome, ${esc(name)}!</h2>
    <p style="margin:0 0 24px;color:#475569;font-size:15px;line-height:1.6;">Your ChatFlow Pro account is ready. Here's how to get started:</p>

    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="padding:14px 0;border-bottom:1px solid #f1f5f9;">
          <table cellpadding="0" cellspacing="0"><tr>
            <td style="vertical-align:top;padding-right:14px;">
              <div style="background:#dbeafe;color:#1d4ed8;width:26px;height:26px;border-radius:50%;text-align:center;line-height:26px;font-size:12px;font-weight:700;">1</div>
            </td>
            <td>
              <p style="margin:0;color:#0f172a;font-size:14px;font-weight:600;">Connect your WhatsApp Business number</p>
              <p style="margin:2px 0 0;color:#64748b;font-size:13px;">Go to WhatsApp Numbers and link your Meta WABA account.</p>
            </td>
          </tr></table>
        </td>
      </tr>
      <tr>
        <td style="padding:14px 0;border-bottom:1px solid #f1f5f9;">
          <table cellpadding="0" cellspacing="0"><tr>
            <td style="vertical-align:top;padding-right:14px;">
              <div style="background:#dbeafe;color:#1d4ed8;width:26px;height:26px;border-radius:50%;text-align:center;line-height:26px;font-size:12px;font-weight:700;">2</div>
            </td>
            <td>
              <p style="margin:0;color:#0f172a;font-size:14px;font-weight:600;">Create and submit message templates</p>
              <p style="margin:2px 0 0;color:#64748b;font-size:13px;">Templates must be approved by Meta before sending campaigns.</p>
            </td>
          </tr></table>
        </td>
      </tr>
      <tr>
        <td style="padding:14px 0;">
          <table cellpadding="0" cellspacing="0"><tr>
            <td style="vertical-align:top;padding-right:14px;">
              <div style="background:#dbeafe;color:#1d4ed8;width:26px;height:26px;border-radius:50%;text-align:center;line-height:26px;font-size:12px;font-weight:700;">3</div>
            </td>
            <td>
              <p style="margin:0;color:#0f172a;font-size:14px;font-weight:600;">Import contacts and launch your first campaign</p>
              <p style="margin:2px 0 0;color:#64748b;font-size:13px;">Upload a CSV or add contacts manually, then run a campaign.</p>
            </td>
          </tr></table>
        </td>
      </tr>
    </table>

    ${btn('Go to Dashboard &rarr;', appUrl)}
  `);
}

function campaignCompletedHtml({ recipientName, campaignName, sent, delivered, read, failed, totalContacts }) {
  const appUrl = env.APP_URL || '#';
  const deliveryRate = sent > 0 ? Math.round((delivered / sent) * 100) : 0;
  const readRate = delivered > 0 ? Math.round((read / delivered) * 100) : 0;

  return layout(`
    <p style="margin:0 0 4px;color:#16a34a;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Campaign Completed</p>
    <h2 style="margin:0 0 6px;color:#0f172a;font-size:22px;font-weight:700;">${campaignName}</h2>
    <p style="margin:0 0 28px;color:#64748b;font-size:14px;">Hi ${recipientName}, your campaign has finished sending. Here's the summary:</p>

    <table width="100%" cellpadding="0" cellspacing="0">
      ${statRow('Total Contacts', totalContacts.toLocaleString())}
      ${statRow('Messages Sent', sent.toLocaleString())}
      ${statRow('Delivered', `${delivered.toLocaleString()} <span style="color:#64748b;font-weight:400;">(${deliveryRate}%)</span>`)}
      ${statRow('Read', `${read.toLocaleString()} <span style="color:#64748b;font-weight:400;">(${readRate}%)</span>`)}
      ${statRow('Failed', `<span style="color:${failed > 0 ? '#dc2626' : '#16a34a'}">${failed.toLocaleString()}</span>`)}
    </table>

    ${btn('View Full Report &rarr;', appUrl)}
  `);
}

function campaignFailedHtml({ recipientName, campaignName }) {
  const appUrl = env.APP_URL || '#';
  return layout(`
    <div style="background:#fef2f2;border-left:4px solid #ef4444;padding:14px 18px;border-radius:0 8px 8px 0;margin:0 0 28px;">
      <p style="margin:0;color:#991b1b;font-size:13px;font-weight:600;">Campaign Failed</p>
    </div>
    <h2 style="margin:0 0 12px;color:#0f172a;font-size:20px;font-weight:700;">${campaignName}</h2>
    <p style="margin:0 0 20px;color:#475569;font-size:14px;line-height:1.6;">Hi ${recipientName}, your campaign encountered an error and could not be completed. This is usually caused by a Meta API issue or an invalid WhatsApp number token.</p>
    <p style="margin:0 0 28px;color:#475569;font-size:14px;line-height:1.6;">Please check the campaign details and try relaunching. If the issue persists, verify that your WhatsApp number connection is still active.</p>
    ${btn('Check Campaign &rarr;', appUrl)}
  `);
}

function templateApprovedHtml({ recipientName, templateName }) {
  const appUrl = env.APP_URL || '#';
  return layout(`
    <div style="background:#f0fdf4;border-left:4px solid #22c55e;padding:14px 18px;border-radius:0 8px 8px 0;margin:0 0 28px;">
      <p style="margin:0;color:#166534;font-size:13px;font-weight:600;">Template Approved by Meta</p>
    </div>
    <h2 style="margin:0 0 12px;color:#0f172a;font-size:20px;font-weight:700;">${templateName}</h2>
    <p style="margin:0 0 20px;color:#475569;font-size:14px;line-height:1.6;">Hi ${recipientName}, great news! Your message template <strong>${templateName}</strong> has been approved by Meta and is now ready to use in campaigns.</p>
    ${btn('Start a Campaign &rarr;', appUrl)}
  `);
}

function templateRejectedHtml({ recipientName, templateName }) {
  const appUrl = env.APP_URL || '#';
  return layout(`
    <div style="background:#fef2f2;border-left:4px solid #ef4444;padding:14px 18px;border-radius:0 8px 8px 0;margin:0 0 28px;">
      <p style="margin:0;color:#991b1b;font-size:13px;font-weight:600;">Template Rejected by Meta</p>
    </div>
    <h2 style="margin:0 0 12px;color:#0f172a;font-size:20px;font-weight:700;">${templateName}</h2>
    <p style="margin:0 0 16px;color:#475569;font-size:14px;line-height:1.6;">Hi ${recipientName}, your message template <strong>${templateName}</strong> was rejected by Meta.</p>
    <p style="margin:0 0 8px;color:#475569;font-size:14px;font-weight:600;">Common reasons for rejection:</p>
    <ul style="margin:0 0 24px;padding-left:20px;color:#64748b;font-size:14px;line-height:2;">
      <li>Promotional content in a transactional template category</li>
      <li>Missing or incorrect variable placeholders</li>
      <li>Content that violates Meta's messaging policies</li>
    </ul>
    <p style="margin:0 0 28px;color:#475569;font-size:14px;">You can edit the template and resubmit it for approval from your dashboard.</p>
    ${btn('Edit Template &rarr;', appUrl)}
  `);
}

function memberInvitedHtml({ inviteeName, inviterName, workspaceName }) {
  const appUrl = env.APP_URL || '#';
  return layout(`
    <h2 style="margin:0 0 12px;color:#0f172a;font-size:22px;font-weight:700;">You've been invited!</h2>
    <p style="margin:0 0 24px;color:#475569;font-size:15px;line-height:1.6;">Hi ${esc(inviteeName)}, <strong>${esc(inviterName)}</strong> has invited you to join the <strong>${esc(workspaceName)}</strong> workspace on ChatFlow Pro.</p>

    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:20px 24px;margin:0 0 28px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="color:#64748b;font-size:13px;padding-bottom:8px;">Invited by</td>
          <td style="color:#0f172a;font-size:13px;font-weight:600;text-align:right;padding-bottom:8px;">${esc(inviterName)}</td>
        </tr>
        <tr>
          <td style="color:#64748b;font-size:13px;">Workspace</td>
          <td style="color:#0f172a;font-size:13px;font-weight:600;text-align:right;">${esc(workspaceName)}</td>
        </tr>
      </table>
    </div>

    <p style="margin:0 0 28px;color:#64748b;font-size:13px;">Log in to your ChatFlow Pro account to access the workspace.</p>
    ${btn('Go to ChatFlow Pro &rarr;', appUrl)}
  `);
}

function inviteWithLinkHtml({ inviterName, workspaceName, token }) {
  // /invite/accept is a frontend SPA route, not a backend one — APP_URL is
  // documented as the backend base URL (used for OAuth callback derivation),
  // so this must use CLIENT_URL instead, same as e.g. the OAuth callback
  // redirects in integrations.controller.js.
  const acceptUrl = `${env.CLIENT_URL}/invite/accept?token=${encodeURIComponent(token)}`;
  return layout(`
    <h2 style="margin:0 0 12px;color:#0f172a;font-size:22px;font-weight:700;">You've been invited!</h2>
    <p style="margin:0 0 24px;color:#475569;font-size:15px;line-height:1.6;"><strong>${esc(inviterName)}</strong> has invited you to join the <strong>${esc(workspaceName)}</strong> workspace on ChatFlow Pro.</p>

    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:20px 24px;margin:0 0 28px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="color:#64748b;font-size:13px;padding-bottom:8px;">Invited by</td>
          <td style="color:#0f172a;font-size:13px;font-weight:600;text-align:right;padding-bottom:8px;">${esc(inviterName)}</td>
        </tr>
        <tr>
          <td style="color:#64748b;font-size:13px;">Workspace</td>
          <td style="color:#0f172a;font-size:13px;font-weight:600;text-align:right;">${esc(workspaceName)}</td>
        </tr>
      </table>
    </div>

    <p style="margin:0 0 28px;color:#64748b;font-size:13px;">If you don't have a ChatFlow Pro account yet, this link will let you create one and join directly. This link expires in 7 days.</p>
    ${btn('Accept Invitation &rarr;', acceptUrl)}
  `);
}

function apiKeyCreatedHtml({ userName, keyName, environment, keyPrefix }) {
  const appUrl = env.APP_URL || '#';
  return layout(`
    <div style="background:#fffbeb;border-left:4px solid #f59e0b;padding:14px 18px;border-radius:0 8px 8px 0;margin:0 0 28px;">
      <p style="margin:0;color:#92400e;font-size:13px;font-weight:600;">Security Alert — New API Key Created</p>
    </div>
    <h2 style="margin:0 0 12px;color:#0f172a;font-size:20px;font-weight:700;">API Key Created</h2>
    <p style="margin:0 0 24px;color:#475569;font-size:14px;line-height:1.6;">Hi ${userName}, a new API key was just created on your account. Here are the details:</p>

    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:20px 24px;margin:0 0 24px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="color:#64748b;font-size:13px;padding-bottom:10px;">Key Name</td>
          <td style="color:#0f172a;font-size:13px;font-weight:600;text-align:right;padding-bottom:10px;">${keyName}</td>
        </tr>
        <tr>
          <td style="color:#64748b;font-size:13px;padding-bottom:10px;">Environment</td>
          <td style="text-align:right;padding-bottom:10px;">${badge(environment, environment === 'production' ? '#fee2e2' : '#dbeafe', environment === 'production' ? '#991b1b' : '#1d4ed8')}</td>
        </tr>
        <tr>
          <td style="color:#64748b;font-size:13px;">Key Prefix</td>
          <td style="color:#0f172a;font-size:13px;font-weight:600;font-family:monospace;text-align:right;">${keyPrefix}...</td>
        </tr>
      </table>
    </div>

    <p style="margin:0 0 28px;color:#64748b;font-size:13px;">If you did not create this key, revoke it immediately from your API Keys settings.</p>
    ${btn('Manage API Keys &rarr;', appUrl)}
  `);
}

// ---------------------------------------------------------------------------
// Build dispatcher (called by email.worker.js)
// ---------------------------------------------------------------------------

const SUBJECTS = {
  welcome:             'Welcome to ChatFlow Pro',
  'campaign-completed': 'Campaign Completed',
  'campaign-failed':   'Campaign Failed — Action Required',
  'template-approved': 'Template Approved by Meta',
  'template-rejected': 'Template Rejected by Meta',
  'member-invited':    "You've been invited to a workspace",
  'workspace-invite':  "You've been invited to a workspace",
  'api-key-created':   'Security Alert: New API Key Created',
  'signup-otp':        'Your ChatFlow Pro verification code',
};

const BUILDERS = {
  welcome:             welcomeHtml,
  'campaign-completed': campaignCompletedHtml,
  'campaign-failed':   campaignFailedHtml,
  'template-approved': templateApprovedHtml,
  'template-rejected': templateRejectedHtml,
  'member-invited':    memberInvitedHtml,
  'workspace-invite':  inviteWithLinkHtml,
  'api-key-created':   apiKeyCreatedHtml,
  'signup-otp':        signupOtpHtml,
};

export function buildEmailHtml(type, payload) {
  const builder = BUILDERS[type];
  if (!builder) throw new Error(`Unknown email type: ${type}`);
  return { subject: SUBJECTS[type], html: builder(payload) };
}

// ---------------------------------------------------------------------------
// Queue helpers (called by services)
// ---------------------------------------------------------------------------

async function getWorkspaceMembers(workspaceId) {
  const members = await prisma.workspaceMember.findMany({
    where: { workspaceId },
    include: { user: { select: { email: true, name: true } } },
  });
  return members.map((m) => ({ email: m.user.email, name: m.user.name }));
}

export async function queueWelcomeEmail(user) {
  await emailQueue.add('welcome', {
    type: 'welcome',
    to: user.email,
    payload: { name: user.name },
  });
}

export async function queueCampaignCompletedEmail(campaign) {
  const ws = await prisma.workspace.findUnique({
    where: { id: campaign.workspaceId },
    select: { emailNotifyCampaignCompleted: true },
  });
  if (!ws?.emailNotifyCampaignCompleted) return;

  const members = await getWorkspaceMembers(campaign.workspaceId);
  for (const m of members) {
    await emailQueue.add('campaign-completed', {
      type: 'campaign-completed',
      to: m.email,
      payload: {
        recipientName: m.name,
        campaignName: campaign.name,
        sent: campaign.sent,
        delivered: campaign.delivered,
        read: campaign.read,
        failed: campaign.failed,
        totalContacts: campaign.totalContacts,
      },
    });
  }
}

export async function queueCampaignFailedEmail(campaign) {
  const ws = await prisma.workspace.findUnique({
    where: { id: campaign.workspaceId },
    select: { emailNotifyCampaignCompleted: true },
  });
  if (!ws?.emailNotifyCampaignCompleted) return;

  const members = await getWorkspaceMembers(campaign.workspaceId);
  for (const m of members) {
    await emailQueue.add('campaign-failed', {
      type: 'campaign-failed',
      to: m.email,
      payload: { recipientName: m.name, campaignName: campaign.name },
    });
  }
}

export async function queueTemplateApprovedEmail(workspaceId, templateName) {
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { emailNotifyTemplateApproved: true },
  });
  if (!ws?.emailNotifyTemplateApproved) return;

  const members = await getWorkspaceMembers(workspaceId);
  for (const m of members) {
    await emailQueue.add('template-approved', {
      type: 'template-approved',
      to: m.email,
      payload: { recipientName: m.name, templateName },
    });
  }
}

export async function queueTemplateRejectedEmail(workspaceId, templateName) {
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { emailNotifyTemplateRejected: true },
  });
  if (!ws?.emailNotifyTemplateRejected) return;

  const members = await getWorkspaceMembers(workspaceId);
  for (const m of members) {
    await emailQueue.add('template-rejected', {
      type: 'template-rejected',
      to: m.email,
      payload: { recipientName: m.name, templateName },
    });
  }
}

export async function queueMemberInvitedEmail({ inviteeEmail, inviteeName, inviterName, workspaceId, workspaceName }) {
  // Workspace names are not unique — settings must be looked up by ID.
  const ws = workspaceId
    ? await prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { emailNotifyMemberInvite: true },
      })
    : null;
  if (ws && !ws.emailNotifyMemberInvite) return;

  await emailQueue.add('member-invited', {
    type: 'member-invited',
    to: inviteeEmail,
    payload: { inviteeName, inviterName, workspaceName },
  });
}

// Token-based invite (works whether or not the invitee has an account yet)
// — reuses the same workspace-level toggle as queueMemberInvitedEmail.
export async function queueWorkspaceInviteEmail({ inviteeEmail, inviterName, workspaceId, workspaceName, token }) {
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { emailNotifyMemberInvite: true },
  });
  if (ws && !ws.emailNotifyMemberInvite) return;

  await emailQueue.add('workspace-invite', {
    type: 'workspace-invite',
    to: inviteeEmail,
    payload: { inviterName, workspaceName, token },
  });
}

export async function queueApiKeyCreatedEmail({ userEmail, userName, keyName, environment, keyPrefix }) {
  await emailQueue.add('api-key-created', {
    type: 'api-key-created',
    to: userEmail,
    payload: { userName, keyName, environment, keyPrefix },
  });
}

function signupOtpHtml({ code, name }) {
  return layout(`
    <h2 style="margin:0 0 8px;color:#0f172a;font-size:22px;font-weight:700;">Verify your email</h2>
    <p style="margin:0 0 20px;color:#475569;font-size:15px;line-height:1.6;">Hi ${esc(name) || 'there'}, use this code to finish creating your ChatFlow Pro account:</p>
    <div style="font-size:32px;font-weight:800;letter-spacing:8px;color:#0f172a;background:#f1f5f9;border-radius:10px;padding:18px;text-align:center;margin:18px 0;">${esc(code)}</div>
    <p style="margin:0;color:#94a3b8;font-size:13px;">This code expires in 10 minutes. If you didn't request it, you can safely ignore this email.</p>
  `);
}

export async function queueSignupOtpEmail({ email, name, code }) {
  await emailQueue.add('signup-otp', { type: 'signup-otp', to: email, payload: { code, name } });
}
