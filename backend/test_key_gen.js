import { PrismaClient } from '@prisma/client';
import { randomBytes, createHash } from 'crypto';

const prisma = new PrismaClient();

async function run() {
  let ws = await prisma.workspace.findFirst();
  if (!ws) {
    // create a fake workspace if none exists
    ws = await prisma.workspace.create({
      data: { name: 'Test Workspace', plan: 'FREE' }
    });
  }

  const raw = 'cfp_' + randomBytes(32).toString('hex');
  const hash = createHash('sha256').update(raw).digest('hex');
  const prefix = raw.slice(0, 12);

  await prisma.apiKey.create({
    data: {
      workspaceId: ws.id,
      name: 'Integration Test Key',
      keyHash: hash,
      keyPrefix: prefix,
      environment: 'development'
    }
  });

  console.log(raw);
  await prisma.$disconnect();
}
run();
