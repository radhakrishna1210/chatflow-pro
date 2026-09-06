import { PrismaClient } from '@prisma/client';
import { computeLeadCategory } from '../services/leadSegmentation.service.js';

const prisma = new PrismaClient();

const testLeads = [
  { name: '[TEST] Rahul Sharma (HOT)', phone: '+919876543201', email: 'rahul.test@example.com', score: 85, source: 'Website', status: 'NEW' },
  { name: '[TEST] Priya Patel (HOT)', phone: '+919876543202', email: 'priya.test@example.com', score: 75, source: 'Google Ads', status: 'CONTACTED' },
  { name: '[TEST] Vikram Malhotra (HOT)', phone: '+919876543203', email: 'vikram.test@example.com', score: 65, source: 'Demo Form', status: 'QUALIFIED' },
  { name: '[TEST] Ananya Gupta (HOT)', phone: '+919876543204', email: 'ananya.test@example.com', score: 62, source: 'Website', status: 'NEW' },
  { name: '[TEST] Suresh Nair (HOT)', phone: '+919876543205', email: 'suresh.test@example.com', score: 80, source: 'Inbound Call', status: 'QUALIFIED' },

  { name: '[TEST] Amit Verma (WARM)', phone: '+919876543206', email: 'amit.test@example.com', score: 45, source: 'Website', status: 'CONTACTED' },
  { name: '[TEST] Sneha Reddy (WARM)', phone: '+919876543207', email: 'sneha.test@example.com', score: 35, source: 'Blog', status: 'NEW' },
  { name: '[TEST] Deepak Kumar (WARM)', phone: '+919876543208', email: 'deepak.test@example.com', score: 40, source: 'Google Ads', status: 'NEW' },
  { name: '[TEST] Neha Joshi (WARM)', phone: '+919876543209', email: 'neha.test@example.com', score: 30, source: 'Event Form', status: 'NEW' },
  { name: '[TEST] Rajesh Singhania (WARM)', phone: '+919876543210', email: 'rajesh.test@example.com', score: 50, source: 'Referral', status: 'CONTACTED' },

  { name: '[TEST] Kavita Shah (COLD)', phone: '+919876543211', email: 'kavita.test@example.com', score: 10, source: 'Cold Import', status: 'NEW' },
  { name: '[TEST] Manoj Tiwari (COLD)', phone: '+919876543212', email: 'manoj.test@example.com', score: 15, source: 'Directory', status: 'UNQUALIFIED' },
  { name: '[TEST] Pooja Agarwal (COLD)', phone: '+919876543213', email: 'pooja.test@example.com', score: 5, source: 'Unknown', status: 'NEW' },
  { name: '[TEST] Tarun Saxena (COLD)', phone: '+919876543214', email: 'tarun.test@example.com', score: 20, source: 'Event List', status: 'NEW' },
  { name: '[TEST] Meera Das (COLD)', phone: '+919876543215', email: 'meera.test@example.com', score: 12, source: 'Social Media', status: 'NEW' },
];

async function main() {
  // Find all workspace IDs associated with user Aditya
  const users = await prisma.user.findMany({
    where: {
      OR: [
        { email: { contains: 'aditya', mode: 'insensitive' } },
        { name: { contains: 'Aditya', mode: 'insensitive' } },
      ],
    },
    include: { workspaceMembers: true },
  });

  const targetWorkspaceIds = new Set();
  for (const u of users) {
    for (const wm of u.workspaceMembers) {
      targetWorkspaceIds.add(wm.workspaceId);
    }
  }

  // Fallback: also include all workspaces that have any contacts/leads
  const activeWorkspaces = await prisma.workspace.findMany({
    where: { contacts: { some: {} } },
    select: { id: true },
    take: 10,
  });

  for (const w of activeWorkspaces) targetWorkspaceIds.add(w.id);

  console.log(`Seeding test data across ${targetWorkspaceIds.size} target workspace(s)...`);

  for (const workspaceId of targetWorkspaceIds) {
    console.log(`Seeding workspace ID: ${workspaceId}...`);
    for (const item of testLeads) {
      let contact = await prisma.contact.findFirst({ where: { workspaceId, phoneNumber: item.phone } });
      if (!contact) {
        contact = await prisma.contact.create({
          data: { workspaceId, name: item.name, phoneNumber: item.phone, email: item.email, tags: ['test-lead'] },
        });
      }

      let lead = await prisma.lead.findUnique({ where: { contactId: contact.id } });
      if (!lead) {
        lead = await prisma.lead.create({
          data: {
            workspaceId,
            contactId: contact.id,
            status: item.status,
            source: item.source,
            score: item.score,
          },
        });
      } else {
        lead = await prisma.lead.update({
          where: { id: lead.id },
          data: { score: item.score, source: item.source, status: item.status },
        });
      }

      await computeLeadCategory(workspaceId, lead.id).catch((e) => console.error(e.message));
    }
  }

  console.log('Recalculating categories for existing leads in target workspaces...');
  for (const workspaceId of targetWorkspaceIds) {
    const leads = await prisma.lead.findMany({ where: { workspaceId }, select: { id: true } });
    for (const l of leads) {
      await computeLeadCategory(workspaceId, l.id).catch(() => {});
    }
  }

  console.log('DONE! Target workspaces seeded successfully.');
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error('Seeding error:', err);
    prisma.$disconnect();
  });
