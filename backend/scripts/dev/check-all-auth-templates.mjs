import '../require-local-db.js'; // keep first: refuses a non-local DATABASE_URL
import { prisma } from "../../src/lib/prisma.js";

const rows = await prisma.template.findMany({
  where: {
    category: "AUTHENTICATION",
  },
  select: {
    id: true,
    name: true,
    status: true,
    language: true,
    waNumberId: true,
  },
});

console.dir(rows, { depth: null });

await prisma.$disconnect();
