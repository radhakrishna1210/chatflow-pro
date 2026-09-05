import { prisma } from "./src/lib/prisma.js";

const rows = await prisma.template.findMany({
  where: {
    category: "AUTHENTICATION",
    status: "APPROVED",
  },
  select: {
    id: true,
    name: true,
    language: true,
    waNumberId: true,
    components: true,
  },
});

console.dir(rows, { depth: null });

await prisma.$disconnect();
