import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
prisma.template.findMany()
  .then(ts => {
      const imgTs = ts.filter(t => t.components?.some(c => c.type === 'HEADER' && c.format === 'IMAGE'));
      console.log('Total IMAGE templates:', imgTs.length);
      imgTs.forEach(t => {
          const h = t.components.find(c => c.type === 'HEADER');
          console.log(`[${t.name}] headerAssetId: ${t.headerAssetId}, example:`, JSON.stringify(h.example));
      });
  })
  .finally(() => prisma.$disconnect());
