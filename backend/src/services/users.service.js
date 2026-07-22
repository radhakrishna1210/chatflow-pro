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
