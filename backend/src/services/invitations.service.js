import { createHash, randomBytes } from 'crypto';
import { prisma } from '../lib/prisma.js';
import { queueWorkspaceInviteEmail } from './email.service.js';
import { assertWithinLimit } from './subscription.service.js';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Same unsalted-SHA-256 pattern auth.service.js uses for the signup OTP —
// safe here because the invite token itself is high-entropy (32 random
// bytes), unlike a guessable 6-digit code. Only the hash is ever persisted;
// the raw token exists transiently to build the emailed link.
const hashToken = (token) => createHash('sha256').update(String(token)).digest('hex');

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

  queueWorkspaceInviteEmail({
    inviteeEmail: normalizedEmail,
    inviterName: inviter.name || 'A workspace admin',
    workspaceId,
    workspaceName: workspace?.name || 'your workspace',
    token: rawToken,
  }).catch(() => {});

  const { tokenHash: _omit, ...safe } = invitation;
  return safe;
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

  const inviter = await prisma.user.findUnique({ where: { id: inviterId }, select: { id: true, name: true } });
  const rawToken = randomBytes(32).toString('hex');
  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { name: true } });

  const updated = await prisma.invitation.update({
    where: { id: invitationId },
    data: { tokenHash: hashToken(rawToken), expiresAt: new Date(Date.now() + INVITE_TTL_MS) },
  });

  queueWorkspaceInviteEmail({
    inviteeEmail: invitation.email,
    inviterName: inviter.name || 'A workspace admin',
    workspaceId,
    workspaceName: workspace?.name || 'your workspace',
    token: rawToken,
  }).catch(() => {});

  const { tokenHash: _omit, ...safe } = updated;
  return safe;
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

  // Lets the accept-invite page steer a logged-out visitor toward "Log in"
  // vs. "Create account" instead of showing both with no guidance.
  const existingUser = await prisma.user.findUnique({ where: { email: invitation.email }, select: { id: true } });

  return {
    email: invitation.email,
    role: invitation.role,
    status: invitation.status,
    workspaceName: invitation.workspace.name,
    inviterName: invitation.invitedBy.name,
    expiresAt: invitation.expiresAt,
    hasAccount: !!existingUser,
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
  if (user.email.toLowerCase() !== invitation.email.toLowerCase()) {
    const e = new Error(`This invite was sent to ${invitation.email}`);
    e.status = 403;
    e.code = 'EMAIL_MISMATCH';
    throw e;
  }

  let member = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId, workspaceId: invitation.workspaceId } },
  });

  if (!member) {
    await assertWithinLimit(invitation.workspaceId, 'member');
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
  await prisma.invitation.updateMany({
    where: { id: invitation.id, status: 'PENDING' },
    data: { status: 'ACCEPTED', acceptedAt: new Date() },
  });

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
    if (invitation.email.toLowerCase() !== String(userEmail).trim().toLowerCase()) return null;

    // Best-effort limit check inside the transaction — if it throws
    // (plan full), fall through to the catch below and skip joining.
    await assertWithinLimit(invitation.workspaceId, 'member');

    await tx.workspaceMember.create({ data: { userId, workspaceId: invitation.workspaceId, role: invitation.role } });
    await tx.invitation.update({ where: { id: invitation.id }, data: { status: 'ACCEPTED', acceptedAt: new Date() } });

    const workspace = await tx.workspace.findUnique({ where: { id: invitation.workspaceId }, select: { id: true, name: true } });
    return { workspaceId: invitation.workspaceId, role: invitation.role, workspace };
  } catch {
    return null;
  }
}
