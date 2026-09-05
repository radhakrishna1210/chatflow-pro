import { prisma } from "./src/lib/prisma.js";

const rows = await prisma.waNumber.findMany({
  select: {
    id: true,
    phoneNumber: true,
    metaPhoneNumberId: true,
    wabaId: true,
    status: true,
    workspaceId: true,
  },
});

console.dir(rows, { depth: null });

await prisma.$disconnect();
