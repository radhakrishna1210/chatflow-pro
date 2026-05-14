import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const deleted = await prisma.waNumber.deleteMany({});
  const reset   = await prisma.numberPool.updateMany({
    where: { status: 'ASSIGNED' },
    data:  { status: 'AVAILABLE', assignedTo: null },
  });

  console.log(`Deleted ${deleted.count} WaNumber record(s).`);
  console.log(`Reset ${reset.count} pool entry/entries back to AVAILABLE.`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
