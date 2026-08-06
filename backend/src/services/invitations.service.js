import { createHash, randomBytes } from 'crypto';
import { prisma } from '../lib/prisma.js';
import { queueWorkspaceInviteEmail } from './email.service.js';
import { assertWithinLimit } from './subscription.service.js';
import { notifyUser } from './notification.service.js';
import { env } from '../config/env.js';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Same unsalted-SHA-256 pattern auth.service.js uses for the signup OTP —
// safe here because the invite token itself is high-entropy (32 random
// bytes), unlike a guessable 6-digit code. Only the hash is ever persisted;
// the raw token exists transiently to build the emailed link.
const hashToken = (token) => createHash('sha256').update(String(token)).digest('hex');

// A shareable invite: no address, reusable, and anyone who opens it joins with
// whatever account they have. Kept in the same table as email invites so
// revoke/expire/list/accept and the seat limit all work identically — the only
// differences are that nothing is emailed and accept skips the address check.
export async function createLinkInvitation(workspaceId, { role, maxUses = null }, inviterId) {
  const inviter = await prisma.user.findUnique({ where: { id: inviterId }, select: { id: true, name: true } });
  if (!inviter) { const e = new Error('Inviter not found'); e.status = 404; throw e; }

  await assertWithinLimit(workspaceId, 'member');

  // Only one live link per role at a time: a second one silently invalidates
  // nothing, so admins would otherwise accumulate shared links they can no
  // longer tell apart or recall.
  await prisma.invitation.updateMany({
    where: { workspaceId, kind: 'LINK', role, status: 'PENDING' },
    data: { status: 'REVOKED', revokedAt: new Date() },
  });

  const rawToken = randomBytes(32).toString('hex');
  const invitation = await prisma.invitation.create({
    data: {
      workspaceId,
      email: null,
      role,
      kind: 'LINK',
      maxUses: Number.isInteger(maxUses) && maxUses > 0 ? maxUses : null,
      tokenHash: hashToken(rawToken),
      invitedByUserId: inviter.id,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    },
  });

  notifyUser(inviter.id, {
    type: 'WORKSPACE_INVITE_SENT',
    workspaceId,
    title: 'Invite link created',
    body: `Anyone with the link joins as ${role === 'ADMIN' ? 'an admin' : 'a member'}. It expires in 7 days.`,
    link: 'settings',
    meta: { invitationId: invitation.id },
  }).catch(() => {});

  const { tokenHash: _omit, ...safe } = invitation;
  return { ...safe, inviteUrl: buildInviteUrl(rawToken) };
}

export async function createInvitation(workspaceId, { email, role }, inviterId) {
  const normalizedEmail = String(email).trim().toLowerCase();
  // req.user (from the JWT) only ever carries id/workspaceId/role/superAdmin
  // — never name — so the real inviter's name has to be looked up here
  // rather than trusted from the caller.
  const inviter = await prisma.user.findUnique({ where: { id: inviterId }, select: { id: true, name: true } });

  const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existingUser) {
    const existingMember = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId: existingUser.id, workspaceId } },
    });
    if (existingMember) { const e = new Error('This person is already a member'); e.status = 409; throw e; }
  }

  // Fail fast — also re-checked at accept time in case the plan filled up
  // between now and then.
  await assertWithinLimit(workspaceId, 'member');

  // Supersede any prior pending invite for this email in this workspace
  // (mirrors startSignup's OTP-invalidation pattern in auth.service.js —
  // no DB-level partial-unique constraint, enforced here instead).
  await prisma.invitation.updateMany({
    where: { workspaceId, email: normalizedEmail, status: 'PENDING' },
    data: { status: 'REVOKED', revokedAt: new Date() },
  });

  const rawToken = randomBytes(32).toString('hex');
  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { name: true } });

  const invitation = await prisma.invitation.create({
    data: {
      workspaceId,
      email: normalizedEmail,
      role,
      tokenHash: hashToken(rawToken),
      invitedByUserId: inviter.id,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    },
  });

  // Whether the email actually got queued decides what the admin is told.
  // This used to be `.catch(() => {})`: if SMTP was misconfigured, the
  // notification flag was off, or Redis was unreachable, the invitation row
  // was still created and the UI reported success — so an invite that nobody
  // could ever receive looked identical to one that was delivered.
  let emailQueued = false;
  try {
    emailQueued = await queueWorkspaceInviteEmail({
      inviteeEmail: normalizedEmail,
      inviterName: inviter.name || 'A workspace admin',
      workspaceId,
      workspaceName: workspace?.name || 'your workspace',
      token: rawToken,
    });
  } catch (err) {
    console.error(`[Invitation] Could not queue invite email to ${normalizedEmail}:`, err.message);
  }

  // Inviting someone who already has an account used to produce nothing they
  // could see in the app — only an email. They get an in-app notification
  // now, so the invite shows up in their bell the moment it is sent.
  if (existingUser) {
    notifyUser(existingUser.id, {
      type: 'WORKSPACE_INVITE',
      title: `You've been invited to ${workspace?.name || 'a workspace'}`,
      body: `${inviter.name || 'A workspace admin'} invited you to join as ${invitation.role === 'ADMIN' ? 'an admin' : 'a member'}. Check your email for the invite link.`,
      link: 'settings',
      meta: { invitationId: invitation.id, workspaceId, role: invitation.role },
    }).catch(() => {});
  }

  // The inviting admin sees confirmation in their own workspace feed.
  notifyUser(inviter.id, {
    type: 'WORKSPACE_INVITE_SENT',
    workspaceId,
    title: `Invitation sent to ${normalizedEmail}`,
    body: `They'll join as ${invitation.role === 'ADMIN' ? 'an admin' : 'a member'} once they accept. The invite expires in 7 days.`,
    link: 'settings',
    meta: { invitationId: invitation.id },
  }).catch(() => {});

  const { tokenHash: _omit, ...safe } = invitation;
  // The raw token is returned once, to the admin who just created the invite
  // — they are authorised to invite and would receive the same link by email
  // anyway. It lets the UI offer a copyable link so invitations still work
  // when email delivery doesn't. It is never returned by list/get.
  return { ...safe, inviteUrl: buildInviteUrl(rawToken), emailQueued };
}

export function buildInviteUrl(rawToken) {
  // Must match the link in inviteWithLinkHtml (email.service.js):
  // /invite/accept is a frontend SPA route, so it hangs off CLIENT_URL.
  return `${env.CLIENT_URL}/invite/accept?token=${encodeURIComponent(rawToken)}`;
}

export async function listInvitations(workspaceId) {
  const invitations = await prisma.invitation.findMany({
    where: { workspaceId, status: 'PENDING' },
    orderBy: { createdAt: 'desc' },
  });
  return invitations.map(({ tokenHash, ...safe }) => safe);
}

// Rotates the token and resets the expiry clock, then re-sends the email —
// same "invalidate the old secret, issue a fresh one" pattern as
// resendSignupOtp in auth.service.js, applied to the existing row instead
// of creating a new one (the invitation id, role, and audit trail stay put;
// only the old email link stops working).
export async function resendInvitation(workspaceId, invitationId, inviterId) {
  const invitation = await prisma.invitation.findFirst({ where: { id: invitationId, workspaceId } });
  if (!invitation) { const e = new Error('Invitation not found'); e.status = 404; throw e; }
  if (invitation.status !== 'PENDING') { const e = new Error('Invitation is no longer pending'); e.status = 409; throw e; }
  if (invitation.kind === 'LINK') {
    const e = new Error('An invite link has no address to resend to. Create a new link instead.'); e.status = 400; throw e;
  }

  const inviter = await prisma.user.findUnique({ where: { id: inviterId }, select: { id: true, name: true } });
  const rawToken = randomBytes(32).toString('hex');
  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { name: true } });

  const updated = await prisma.invitation.update({
    where: { id: invitationId },
    data: { tokenHash: hashToken(rawToken), expiresAt: new Date(Date.now() + INVITE_TTL_MS) },
  });

  let emailQueued = false;
  try {
    emailQueued = await queueWorkspaceInviteEmail({
      inviteeEmail: invitation.email,
      inviterName: inviter.name || 'A workspace admin',
      workspaceId,
      workspaceName: workspace?.name || 'your workspace',
      token: rawToken,
    });
  } catch (err) {
    console.error(`[Invitation] Could not queue resend to ${invitation.email}:`, err.message);
  }

  const { tokenHash: _omit, ...safe } = updated;
  // Resending rotates the token, so the previous link is dead — hand back the
  // new one for the same copy-link fallback as create.
  return { ...safe, inviteUrl: buildInviteUrl(rawToken), emailQueued };
}

export async function revokeInvitation(workspaceId, invitationId) {
  const invitation = await prisma.invitation.findFirst({ where: { id: invitationId, workspaceId } });
  if (!invitation) { const e = new Error('Invitation not found'); e.status = 404; throw e; }
  if (invitation.status !== 'PENDING') { const e = new Error('Invitation is no longer pending'); e.status = 409; throw e; }

  await prisma.invitation.update({
    where: { id: invitationId },
    data: { status: 'REVOKED', revokedAt: new Date() },
  });
}

// Public preview for the accept-invite page — no auth required to view.
export async function getInvitationByToken(rawToken) {
  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    include: { workspace: { select: { name: true } }, invitedBy: { select: { name: true } } },
  });
  if (!invitation) return null;

  if (invitation.status === 'PENDING' && invitation.expiresAt < new Date()) {
    await prisma.invitation.update({ where: { id: invitation.id }, data: { status: 'EXPIRED' } });
    invitation.status = 'EXPIRED';
  }

  // A link invite is exhausted once it hits its cap, even if a concurrent
  // accept hasn't flipped the status yet.
  if (invitation.kind === 'LINK' && invitation.maxUses && invitation.useCount >= invitation.maxUses) {
    invitation.status = 'ACCEPTED';
  }

  // Lets the accept-invite page steer a logged-out visitor toward "Log in"
  // vs. "Create account" instead of showing both with no guidance. A link
  // invite has no address to look up, so the page offers both.
  const existingUser = invitation.email
    ? await prisma.user.findUnique({ where: { email: invitation.email }, select: { id: true } })
    : null;

  return {
    email: invitation.email,
    kind: invitation.kind,
    role: invitation.role,
    status: invitation.status,
    workspaceName: invitation.workspace.name,
    inviterName: invitation.invitedBy.name,
    expiresAt: invitation.expiresAt,
    hasAccount: !!existingUser,
    usesLeft: invitation.maxUses ? Math.max(0, invitation.maxUses - invitation.useCount) : null,
  };
}

// Used by the authenticated accept HTTP endpoint. Throws on any invalid
// state — the caller (an explicit "Accept" button click) should surface
// the error to the user.
export async function acceptInvitation(rawToken, userId) {
  const invitation = await prisma.invitation.findUnique({ where: { tokenHash: hashToken(rawToken) } });
  if (!invitation) { const e = new Error('Invite not found'); e.status = 404; throw e; }

  if (invitation.status === 'PENDING' && invitation.expiresAt < new Date()) {
    await prisma.invitation.update({ where: { id: invitation.id }, data: { status: 'EXPIRED' } });
    const e = new Error('This invite has expired'); e.status = 410; throw e;
  }
  if (invitation.status !== 'PENDING') { const e = new Error('This invite is no longer valid'); e.status = 410; throw e; }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) { const e = new Error('User not found'); e.status = 404; throw e; }
  // A LINK invite is deliberately not bound to an address — that is the whole
  // point of a shareable link — so only EMAIL invites check who is accepting.
  if (invitation.kind === 'EMAIL' && user.email.toLowerCase() !== String(invitation.email).toLowerCase()) {
    const e = new Error(`This invite was sent to ${invitation.email}`);
    e.status = 403;
    e.code = 'EMAIL_MISMATCH';
    throw e;
  }
  let member = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId, workspaceId: invitation.workspaceId } },
  });
  // Someone re-opening a link they already joined through is a no-op: they
  // keep their membership, no use is burned, and the seat cap doesn't apply
  // to them. Checked before the cap so the last person to join can revisit
  // their own link without being told it's exhausted.
  const alreadyMember = !!member;

  if (!alreadyMember && invitation.kind === 'LINK' && invitation.maxUses && invitation.useCount >= invitation.maxUses) {
    const e = new Error('This invite link has been used the maximum number of times'); e.status = 410; throw e;
  }

  if (!member) {
    // This invitation is still PENDING here — exclude it so it isn't counted
    // both as a pending seat and as the member it's about to become.
    await assertWithinLimit(invitation.workspaceId, 'member', { ignoreInvitationId: invitation.id });
    try {
      member = await prisma.workspaceMember.create({
        data: { userId, workspaceId: invitation.workspaceId, role: invitation.role },
      });
    } catch (err) {
      // P2002 (unique violation on userId+workspaceId): a concurrent request
      // for the same invite (double-click, duplicate submit, two tabs) won
      // the race and already created this membership — not an error, just
      // means we're now idempotently converging on the same result. Not run
      // inside the transaction below: on Postgres, a failed statement poisons
      // the rest of that transaction, so this needs its own try/catch outside
      // of it rather than being swallowed mid-transaction.
      if (err.code !== 'P2002') throw err;
      member = await prisma.workspaceMember.findUnique({
        where: { userId_workspaceId: { userId, workspaceId: invitation.workspaceId } },
      });
    }
  }

  // Guarded by status so a concurrent request that already flipped this to
  // ACCEPTED (or the token being reused after expiry raced it to EXPIRED)
  // doesn't get clobbered back — this update is a no-op if so, not an error.
  if (invitation.kind === 'LINK') {
    if (!alreadyMember) {
      // A link stays PENDING and keeps working until it runs out of uses,
      // expires, or is revoked. The increment is done in the same guarded
      // update so two people accepting at once can't share one use.
      const { count } = await prisma.invitation.updateMany({
        where: {
          id: invitation.id,
          status: 'PENDING',
          ...(invitation.maxUses ? { useCount: { lt: invitation.maxUses } } : {}),
        },
        data: { useCount: { increment: 1 } },
      });
      if (count && invitation.maxUses && invitation.useCount + 1 >= invitation.maxUses) {
        await prisma.invitation.updateMany({
          where: { id: invitation.id, status: 'PENDING', useCount: { gte: invitation.maxUses } },
          data: { status: 'ACCEPTED', acceptedAt: new Date() },
        });
      }
    }
  } else {
    await prisma.invitation.updateMany({
      where: { id: invitation.id, status: 'PENDING' },
      data: { status: 'ACCEPTED', acceptedAt: new Date(), useCount: { increment: 1 } },
    });
  }

  return { workspaceId: invitation.workspaceId, role: member.role };
}

// Used from inside verifySignup's transaction (new-account-via-invite path).
// Never throws — a bad/expired/mismatched invite must not block basic
// account creation, it just means the new user won't be pre-joined to a
// workspace and lands on /setup like any other fresh signup.
export async function consumeInvitationAtomically(tx, rawToken, userEmail, userId) {
  try {
    const invitation = await tx.invitation.findUnique({ where: { tokenHash: hashToken(rawToken) } });
    if (!invitation) return null;
    if (invitation.status !== 'PENDING') return null;
    if (invitation.expiresAt < new Date()) return null;
    // Signing up through a shared link is the expected path for someone with
    // no account yet, so only an email invite pins the address.
    if (invitation.kind === 'EMAIL' && String(invitation.email).toLowerCase() !== String(userEmail).trim().toLowerCase()) return null;
    if (invitation.kind === 'LINK' && invitation.maxUses && invitation.useCount >= invitation.maxUses) return null;

    // Best-effort limit check inside the transaction — if it throws
    // (plan full), fall through to the catch below and skip joining.
    await assertWithinLimit(invitation.workspaceId, 'member', { ignoreInvitationId: invitation.id });

    await tx.workspaceMember.create({ data: { userId, workspaceId: invitation.workspaceId, role: invitation.role } });
    // A link keeps working for the next person unless this use exhausts it.
    const exhausts = invitation.kind === 'EMAIL' || (invitation.maxUses && invitation.useCount + 1 >= invitation.maxUses);
    await tx.invitation.update({
      where: { id: invitation.id },
      data: {
        useCount: { increment: 1 },
        ...(exhausts ? { status: 'ACCEPTED', acceptedAt: new Date() } : {}),
      },
    });

    const workspace = await tx.workspace.findUnique({ where: { id: invitation.workspaceId }, select: { id: true, name: true } });
    return { workspaceId: invitation.workspaceId, role: invitation.role, workspace };
  } catch {
    return null;
  }
}
