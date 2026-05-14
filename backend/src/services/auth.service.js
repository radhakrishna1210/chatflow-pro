import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';

function generateTokens(userId, workspaceId, role) {
  const accessToken = jwt.sign(
    { sub: userId, workspaceId, role },
    env.JWT_ACCESS_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN }
  );
  const refreshToken = jwt.sign(
    { sub: userId },
    env.JWT_REFRESH_SECRET,
    { expiresIn: env.JWT_REFRESH_EXPIRES_IN }
  );
  return { accessToken, refreshToken };
}

async function storeRefreshToken(userId, token) {
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await prisma.refreshToken.create({ data: { userId, token, expiresAt } });
}

function resolveRole(email) {
  return email.toLowerCase() === env.ADMIN_EMAIL.toLowerCase() ? 'ADMIN' : 'CLIENT';
}

export async function register({ name, email, password }) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    const err = new Error('Email already in use');
    err.status = 409;
    throw err;
  }

  const role = resolveRole(email);
  const passwordHash = await bcrypt.hash(password, env.BCRYPT_SALT_ROUNDS);
  const user = await prisma.user.create({ data: { name, email, passwordHash } });

  const workspace = await prisma.workspace.create({
    data: {
      name: `${name}'s Workspace`,
      members: { create: { userId: user.id, role } },
    },
  });

  const { accessToken, refreshToken } = generateTokens(user.id, workspace.id, role);
  await storeRefreshToken(user.id, refreshToken);

  return {
    accessToken, refreshToken,
    user: { id: user.id, name: user.name, email: user.email, role },
    workspace: { id: workspace.id, name: workspace.name },
  };
}

export async function login({ email, password }) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.passwordHash) {
    const err = new Error('Invalid credentials');
    err.status = 401;
    throw err;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    const err = new Error('Invalid credentials');
    err.status = 401;
    throw err;
  }

  const member = await prisma.workspaceMember.findFirst({
    where: { userId: user.id },
    include: { workspace: true },
    orderBy: { joinedAt: 'asc' },
  });

  if (!member) {
    const err = new Error('No workspace found');
    err.status = 404;
    throw err;
  }

  const role = resolveRole(user.email);
  const { accessToken, refreshToken } = generateTokens(user.id, member.workspaceId, role);
  await storeRefreshToken(user.id, refreshToken);

  return {
    accessToken,
    refreshToken,
    user: { id: user.id, name: user.name, email: user.email, role },
    workspace: { id: member.workspaceId, name: member.workspace.name },
  };
}

export async function refresh(token) {
  let payload;
  try {
    payload = jwt.verify(token, env.JWT_REFRESH_SECRET);
  } catch {
    const err = new Error('Invalid refresh token');
    err.status = 401;
    throw err;
  }

  const stored = await prisma.refreshToken.findUnique({ where: { token } });
  if (!stored || stored.expiresAt < new Date()) {
    const err = new Error('Refresh token expired or not found');
    err.status = 401;
    throw err;
  }

  await prisma.refreshToken.delete({ where: { token } });

  const member = await prisma.workspaceMember.findFirst({
    where: { userId: payload.sub },
    orderBy: { joinedAt: 'asc' },
  });

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  const role = resolveRole(user?.email ?? '');
  const { accessToken, refreshToken: newRefreshToken } = generateTokens(
    payload.sub,
    member?.workspaceId,
    role
  );
  await storeRefreshToken(payload.sub, newRefreshToken);

  return { accessToken, refreshToken: newRefreshToken };
}

export async function logout(token) {
  if (token) {
    await prisma.refreshToken.deleteMany({ where: { token } });
  }
}

export async function findOrCreateGoogleUser({ googleId, email, name }) {
  let user = await prisma.user.findFirst({
    where: { OR: [{ googleId }, { email }] },
  });

  if (user) {
    if (!user.googleId) {
      user = await prisma.user.update({ where: { id: user.id }, data: { googleId } });
    }
  } else {
    const newRole = resolveRole(email);
    user = await prisma.user.create({ data: { name, email, googleId } });
    await prisma.workspace.create({
      data: {
        name: `${name}'s Workspace`,
        members: { create: { userId: user.id, role: newRole } },
      },
    });
  }

  const member = await prisma.workspaceMember.findFirst({
    where: { userId: user.id },
    include: { workspace: true },
    orderBy: { joinedAt: 'asc' },
  });

  const role = resolveRole(user.email);
  const { accessToken, refreshToken } = generateTokens(user.id, member.workspaceId, role);
  await storeRefreshToken(user.id, refreshToken);

  return {
    accessToken,
    refreshToken,
    user: { id: user.id, name: user.name, email: user.email, role },
    workspace: { id: member.workspaceId, name: member.workspace.name },
  };
}
