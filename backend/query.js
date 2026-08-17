import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
prisma.template.findFirst({ where: { name: 'order_shipped_update' } })
  .then(t => console.dir(t, { depth: null }))
  .finally(() => prisma.$disconnect());
