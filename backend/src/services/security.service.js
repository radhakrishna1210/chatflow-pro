import { prisma } from '../lib/prisma.js';
import bcrypt from 'bcryptjs';
import { getWorkspaceMetadata, updateWorkspaceMetadata } from './metadata.service.js';

export async function getSessions(userId) {
  const tokens = await prisma.refreshToken.findMany({
    where: { userId },
    select: { id: true, expiresAt: true, createdAt: true }
  });
  return tokens.map(t => ({
    id: t.id,
    device: 'Web Session',
    location: 'Active Location',
    time: t.createdAt,
    expiresAt: t.expiresAt
  }));
}

export async function revokeSession(userId, sessionId) {
  return prisma.refreshToken.deleteMany({
    where: { id: sessionId, userId }
  });
}

export async function changePassword(userId, currentPassword, newPassword) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error('User not found');
  
  if (user.passwordHash) {
    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) throw new Error('Incorrect current password');
  }
  
  const hash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: hash }
  });
  return { success: true };
}

export async function get2FA(workspaceId) {
  const meta = getWorkspaceMetadata(workspaceId);
  return { twoFactorEnabled: !!meta.twoFactorEnabled };
}

export async function toggle2FA(workspaceId, enabled) {
  updateWorkspaceMetadata(workspaceId, { twoFactorEnabled: !!enabled });
  return { twoFactorEnabled: !!enabled };
}
