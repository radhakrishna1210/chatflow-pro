import { createHash, randomUUID } from 'crypto';
import { prisma } from '../lib/prisma.js';

// Refresh-token storage.
//
// Only a sha256 of each token is stored: the token is a high-entropy signed
// JWT, so a plain hash is enough to make a database dump useless as a set of
// bearer credentials. Rows written before hashing still carry the raw token in
// `token`; they are found by either column and are hashed in place the first
// time they are used, so the change never signs a live session out. Any that
// are never used again expire on their own within JWT_REFRESH_EXPIRES_IN.
//
// Rotation keeps the used row (marked `rotatedAt`) until it expires. All the
// rows one sign-in produces share a `familyId`, so a token presented after it
// was already rotated means two parties hold the chain — the whole family is
// revoked and both have to sign in again.

// Two tabs share one refresh token and can race to rotate it. The loser
// presents a token rotated a moment ago; that is not theft, so within this
// window it is refused without revoking anything.
export const ROTATION_GRACE_MS = 30_000;

export function hashRefreshToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

export async function storeRefreshToken({ userId, token, expiresAt, workspaceId = null, familyId = null }) {
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: hashRefreshToken(token),
      familyId: familyId || randomUUID(),
      workspaceId: workspaceId || null,
      expiresAt,
    },
  });
  // Opportunistic cleanup so expired tokens don't pile up forever.
  prisma.refreshToken.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch((err) => console.warn('[Auth] Expired refresh-token cleanup failed:', err.message));
}

export async function findRefreshToken(token) {
  if (!token) return null;
  return prisma.refreshToken.findFirst({
    where: { OR: [{ tokenHash: hashRefreshToken(token) }, { token }] },
  });
}

// Marks the row as used. Exactly one caller wins; a concurrent rotation of the
// same token gets false. A legacy plaintext row loses its raw token here.
export async function claimForRotation(row, token) {
  const { count } = await prisma.refreshToken.updateMany({
    where: { id: row.id, rotatedAt: null },
    data: {
      rotatedAt: new Date(),
      token: null,
      tokenHash: hashRefreshToken(token),
      familyId: row.familyId || row.id,
    },
  });
  return count === 1;
}

function familyWhere(row) {
  return row.familyId ? { familyId: row.familyId } : { id: row.id };
}

export async function revokeFamily(row) {
  const { count } = await prisma.refreshToken.deleteMany({ where: familyWhere(row) });
  return count;
}

export function isWithinRotationGrace(row, now = Date.now()) {
  return Boolean(row.rotatedAt) && now - new Date(row.rotatedAt).getTime() < ROTATION_GRACE_MS;
}

// Signs out every session except the one `keepToken` belongs to.
export async function revokeOtherFamilies(userId, keepToken) {
  const current = keepToken ? await findRefreshToken(keepToken) : null;
  let where = { userId };
  if (current && current.userId === userId) {
    where = { userId, id: { not: current.id } };
    if (current.familyId) where.OR = [{ familyId: null }, { familyId: { not: current.familyId } }];
  }
  // Report live sessions only — a family's rotated rows are not sessions.
  const { count } = await prisma.refreshToken.deleteMany({ where: { ...where, rotatedAt: null } });
  await prisma.refreshToken.deleteMany({ where });
  return count;
}
