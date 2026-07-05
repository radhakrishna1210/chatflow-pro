import bcrypt from 'bcryptjs';
import { prisma } from '../src/lib/prisma.js';

async function main() {
  const email = 'test@example.com';
  const password = 'password123';
  const name = 'Test User';

  const passwordHash = await bcrypt.hash(password, 12);

  // Find if user already exists
  const existing = await prisma.user.findUnique({ where: { email } });
  let user;
  if (existing) {
    user = await prisma.user.update({
      where: { email },
      data: { name, passwordHash },
    });
    console.log('Updated existing user:', user.email);
  } else {
    user = await prisma.user.create({
      data: { name, email, passwordHash },
    });
    console.log('Created new user:', user.email);
  }

  // Ensure user has a workspace
  const member = await prisma.workspaceMember.findFirst({
    where: { userId: user.id },
    include: { workspace: true },
  });

  if (!member) {
    const workspace = await prisma.workspace.create({
      data: {
        name: `${name}'s Workspace`,
        members: { create: { userId: user.id, role: 'ADMIN' } },
      },
    });
    console.log('Created workspace:', workspace.name);
  } else {
    console.log('User already has workspace:', member.workspace.name);
  }
}

main()
  .catch(err => console.error(err))
  .finally(() => prisma.$disconnect());
