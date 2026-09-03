import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding CRM data...');

  const workspaces = await prisma.workspace.findMany();
  if (workspaces.length === 0) {
    console.error('No workspaces found.');
    process.exit(1);
  }

  for (const workspace of workspaces) {
    const workspaceId = workspace.id;
    const user = await prisma.user.findFirst(); // just grab any user as owner
    console.log(`Seeding data for workspace: ${workspace.name} (${workspaceId})`);

  // Create Contacts
  const contacts = [];
  const runId = Math.floor(Math.random() * 10000);
  for (let i = 1; i <= 5; i++) {
    const contact = await prisma.contact.create({
      data: {
        workspaceId,
        name: `Dummy Contact ${i}`,
        phoneNumber: `919${runId.toString().padStart(4, '0')}000${i}`,
        email: `contact${runId}${i}@example.com`,
      }
    });
    contacts.push(contact);
  }

  // Create Leads
  const leads = [];
  const statuses = ['NEW', 'CONTACTED', 'QUALIFIED', 'UNQUALIFIED'];
  for (let i = 0; i < 4; i++) {
    const lead = await prisma.lead.create({
      data: {
        workspaceId,
        contactId: contacts[i].id,
        status: statuses[i],
        source: 'Website Form',
        ownerUserId: user.id,
        score: Math.floor(Math.random() * 100),
      }
    });
    leads.push(lead);
  }

  // Create Deals
  const deals = [];
  const stages = ['QUALIFICATION', 'NEEDS_ANALYSIS', 'PROPOSAL', 'NEGOTIATION', 'CLOSED_WON'];
  for (let i = 0; i < 5; i++) {
    const deal = await prisma.deal.create({
      data: {
        workspaceId,
        contactId: contacts[i].id,
        leadId: i < leads.length ? leads[i].id : null,
        title: `Enterprise Q3 Expansion - Deal ${i+1}`,
        value: (i + 1) * 10000,
        currency: 'INR',
        stage: stages[i],
        ownerUserId: user.id,
        expectedCloseDate: new Date(Date.now() + (i * 7) * 24 * 60 * 60 * 1000), // Future dates
      }
    });
    deals.push(deal);
  }

  // Create Tasks
  for (let i = 0; i < 3; i++) {
    await prisma.task.create({
      data: {
        workspaceId,
        title: `Follow up with Deal ${i+1}`,
        description: 'Call them to discuss the new proposal.',
        status: i === 0 ? 'COMPLETED' : 'PENDING',
        dueDate: new Date(Date.now() + (i - 1) * 24 * 60 * 60 * 1000), // Past, Today, Tomorrow
        assignedToUserId: user.id,
        dealId: deals[i].id,
        contactId: deals[i].contactId,
      }
    });
  }

  // Create CrmActivities
  for (let i = 0; i < 3; i++) {
    await prisma.crmActivity.create({
      data: {
        workspaceId,
        type: 'NOTE',
        content: `Had a great initial sync. They are very interested in the Growth plan.`,
        createdByUserId: user.id,
        dealId: deals[i].id,
        contactId: deals[i].contactId,
      }
    });
  }

  } // End of workspace loop

  console.log('✅ Successfully seeded dummy CRM data!');
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
