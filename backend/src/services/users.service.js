import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';

export async function getProfile(userId, workspaceId) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) { const e = new Error('User not found'); e.status = 404; throw e; }

  const member = workspaceId
    ? await prisma.workspaceMember.findUnique({
        where: { userId_workspaceId: { userId, workspaceId } },
        include: { workspace: true },
      })
    : null;

  const sessionsCount = await prisma.refreshToken.count({
    where: { userId, expiresAt: { gt: new Date() } },
  });

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    jobTitle: user.jobTitle,
    company: user.company,
    timezone: user.timezone,
    language: user.language,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastLoginAt: user.lastLoginAt,
    hasPassword: !!user.passwordHash,
    sessionsCount,
    workspaceName: member?.workspace?.name ?? null,
    workspacePlan: member?.workspace?.plan ?? null,
    workspaceSuspended: member?.workspace?.suspended ?? false,
    memberSince: member?.joinedAt ?? null,
  };
}

// Whitelisted update — mass-assignment safe (name/phone/jobTitle/company/
// timezone/language only). Empty strings are normalized to null.
export async function updateProfile(userId, data) {
  const fields = ['name', 'phone', 'jobTitle', 'company', 'timezone', 'language'];
  const update = {};
  for (const f of fields) {
    if (data[f] === undefined) continue;
    update[f] = data[f] === '' ? null : data[f];
  }
  if (update.name === null) delete update.name; // name is required, never null it out

  const user = await prisma.user.update({ where: { id: userId }, data: update });
  return {
    name: user.name, phone: user.phone, jobTitle: user.jobTitle,
    company: user.company, timezone: user.timezone, language: user.language,
    updatedAt: user.updatedAt,
  };
}

export async function changePassword(userId, currentPassword, newPassword) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) { const e = new Error('User not found'); e.status = 404; throw e; }

  if (!user.passwordHash) {
    const e = new Error('This account signs in with Google and has no password to change');
    e.status = 400;
    throw e;
  }

  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) {
    const e = new Error('Current password is incorrect');
    e.status = 401;
    throw e;
  }

  const passwordHash = await bcrypt.hash(newPassword, env.BCRYPT_SALT_ROUNDS);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  return { message: 'Password updated successfully' };
}

// `currentToken` (the caller's own refresh token) is only ever compared
// server-side — the raw token value is never included in the response.
export async function listSessions(userId, currentToken) {
  const sessions = await prisma.refreshToken.findMany({
    where: { userId, expiresAt: { gt: new Date() } },
    select: { id: true, token: true, createdAt: true, expiresAt: true },
    orderBy: { createdAt: 'desc' },
  });
  return sessions.map(({ token, ...rest }) => ({ ...rest, isCurrent: token === currentToken }));
}

export async function revokeOtherSessions(userId, keepToken) {
  const where = keepToken
    ? { userId, token: { not: keepToken } }
    : { userId };
  const result = await prisma.refreshToken.deleteMany({ where });
  return { revoked: result.count };
}

// ─── Account deletion ────────────────────────────────────────────────────────

// Splits the user's workspaces into the ones that die with the account (they
// have no other member) and the ones that would be left without an admin.
// Shared by the preview and the delete itself so the confirmation the user
// reads is computed exactly the same way as the action they confirm.
async function analyseAccountDeletion(userId) {
  const memberships = await prisma.workspaceMember.findMany({
    where: { userId },
    include: { workspace: { select: { id: true, name: true } } },
  });

  const soleOwned = [];   // no one else is in them — deleted with the account
  const blocked = [];     // others remain but this user is the only admin
  const leaving = [];     // others remain and can still administer it

  for (const m of memberships) {
    const [otherMembers, otherAdmins] = await Promise.all([
      prisma.workspaceMember.count({ where: { workspaceId: m.workspaceId, userId: { not: userId } } }),
      prisma.workspaceMember.count({ where: { workspaceId: m.workspaceId, userId: { not: userId }, role: 'ADMIN' } }),
    ]);
    const entry = { id: m.workspaceId, name: m.workspace?.name || 'Workspace', role: m.role };
    if (otherMembers === 0) soleOwned.push(entry);
    else if (m.role === 'ADMIN' && otherAdmins === 0) blocked.push(entry);
    else leaving.push(entry);
  }

  return { soleOwned, blocked, leaving };
}

// What deleting the account would do, so the UI can spell it out before the
// user commits to something irreversible.
export async function previewAccountDeletion(userId) {
  const { soleOwned, blocked, leaving } = await analyseAccountDeletion(userId);
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, passwordHash: true } });
  if (!user) { const e = new Error('User not found'); e.status = 404; throw e; }

  return {
    email: user.email,
    // Google-only accounts have no password to check, so the UI asks the user
    // to type their email address instead.
    requiresPassword: !!user.passwordHash,
    workspacesToDelete: soleOwned,
    workspacesToLeave: leaving,
    blockedBy: blocked,
    canDelete: blocked.length === 0,
  };
}

// Irreversible. Deletes the account, every workspace only this user belongs
// to (cascading to that workspace's campaigns, contacts, conversations and
// billing rows), and the user's memberships elsewhere.
export async function deleteAccount(userId, { password, confirmEmail } = {}) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) { const e = new Error('User not found'); e.status = 404; throw e; }

  // Re-authenticate: a stolen session must not be able to delete the account.
  if (user.passwordHash) {
    if (!password) { const e = new Error('Your password is required to delete your account'); e.status = 400; throw e; }
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) { const e = new Error('Password is incorrect'); e.status = 401; throw e; }
  } else {
    // Google sign-in — no password exists, so confirm by typing the address.
    if (String(confirmEmail || '').trim().toLowerCase() !== user.email.toLowerCase()) {
      const e = new Error('Type your email address to confirm deletion'); e.status = 400; throw e;
    }
  }

  const { soleOwned, blocked } = await analyseAccountDeletion(userId);
  if (blocked.length > 0) {
    const e = new Error(
      `You are the only admin of ${blocked.map((w) => `"${w.name}"`).join(', ')}. ` +
      'Promote another member to admin, or remove the other members, before deleting your account.'
    );
    e.status = 409;
    throw e;
  }

  await prisma.$transaction(async (tx) => {
    // Invitation.invitedBy is a required relation, so its foreign key blocks
    // the user delete until these rows are gone.
    await tx.invitation.deleteMany({ where: { invitedByUserId: userId } });
    // Workspaces nobody else belongs to go with the account; everything they
    // own cascades from the Workspace row.
    if (soleOwned.length > 0) {
      await tx.workspace.deleteMany({ where: { id: { in: soleOwned.map((w) => w.id) } } });
    }
    // Memberships, refresh tokens and notifications all cascade from User.
    await tx.user.delete({ where: { id: userId } });
  }, { maxWait: 15_000, timeout: 30_000 });

  console.log(`[Account] Deleted user ${userId} (${user.email}) and ${soleOwned.length} sole-owned workspace(s)`);
  return { deleted: true, workspacesDeleted: soleOwned.length };
}
