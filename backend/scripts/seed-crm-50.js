import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const FIRST_NAMES = [
  'Aarav', 'Priya', 'Vikram', 'Ananya', 'Rohan', 'Neha', 'Arjun', 'Isha', 'Siddharth', 'Kavita',
  'Aditya', 'Sneha', 'Rahul', 'Pooja', 'Karan', 'Meera', 'Varun', 'Divya', 'Sameer', 'Rhea',
  'Gaurav', 'Tanvi', 'Abhishek', 'Shreya', 'Manish', 'Kritika', 'Nikhil', 'Swati', 'Harsh', 'Simran',
  'Akash', 'Rashmi', 'Prateek', 'Pallavi', 'Yash', 'Shruti', 'Ankit', 'Ritu', 'Mohit', 'Payal',
  'Rajesh', 'Sunita', 'Deepak', 'Alka', 'Sanjay', 'Geeta', 'Amit', 'Rekha', 'Kunal', 'Jyoti'
];

const LAST_NAMES = [
  'Sharma', 'Patel', 'Malhotra', 'Deshmukh', 'Mehta', 'Verma', 'Reddy', 'Singhal', 'Nair', 'Rao',
  'Kulkarni', 'Joshi', 'Kapoor', 'Chopra', 'Gupta', 'Bansal', 'Agarwal', 'Bhatia', 'Iyer', 'Menon',
  'Choudhury', 'Mukherjee', 'Chatterjee', 'Sen', 'Dutta', 'Banerjee', 'Ghosh', 'Das', 'Roy', 'Basu',
  'Pandey', 'Mishra', 'Tripathi', 'Tiwari', 'Shukla', 'Dubey', 'Chaubey', 'Upadhyay', 'Pathak', 'Dixit',
  'Saxena', 'Srivastava', 'Mathur', 'Bhatnagar', 'Johri', 'Kulshrestha', 'Nigam', 'Asthana', 'Sinha', 'Verma'
];

const SOURCES = ['INSTAGRAM', 'WHATSAPP', 'WEBSITE', 'REFERRAL', 'FACEBOOK_ADS', 'GOOGLE_SEARCH'];
const STATUSES = ['NEW', 'CONTACTED', 'QUALIFIED', 'UNQUALIFIED'];
const CATEGORIES = ['HOT', 'WARM', 'COLD'];
const DEAL_STAGES = ['QUALIFICATION', 'NEEDS_ANALYSIS', 'PROPOSAL', 'NEGOTIATION', 'CLOSED_WON', 'CLOSED_LOST'];
const ACTIVITY_TYPES = ['CALL', 'CALL', 'VIDEO_CALL', 'MESSAGES', 'VISITS', 'NOTE', 'MEETING'];

async function seedSingleLead(i, wsId, repUsers, leadForm) {
  const fn = FIRST_NAMES[i % FIRST_NAMES.length];
  const ln = LAST_NAMES[i % LAST_NAMES.length];
  const fullName = `${fn} ${ln}`;
  const phoneSuffix = `${(20000000 + i * 13579 + (wsId.charCodeAt(wsId.length - 1) * 1000)).toString().slice(0, 8)}`;
  const phoneNum = `+9198${phoneSuffix}`;
  const email = `${fn.toLowerCase()}.${ln.toLowerCase()}.${wsId.slice(-4)}.${i}@growthcrm.in`;

  const source = SOURCES[i % SOURCES.length];
  const status = STATUSES[i % STATUSES.length];
  const category = i < 20 ? 'HOT' : i < 38 ? 'WARM' : 'COLD';
  const score = category === 'HOT' ? 80 + (i % 19) : category === 'WARM' ? 52 + (i % 26) : 15 + (i % 30);
  const assignedUser = repUsers[i % repUsers.length];

  // A. Contact
  let contact = await prisma.contact.findFirst({
    where: { workspaceId: wsId, phoneNumber: phoneNum }
  });
  if (!contact) {
    contact = await prisma.contact.create({
      data: {
        workspaceId: wsId,
        name: fullName,
        phoneNumber: phoneNum,
        email: email,
        customFields: {
          company: `${ln} Holdings & Ventures`,
          city: i % 2 === 0 ? 'Mumbai' : i % 3 === 0 ? 'Bengaluru' : 'Delhi NCR',
          budgetTier: category,
        },
        tags: [source, category, status],
      }
    });
  }

  // B. Lead
  let lead = await prisma.lead.findFirst({
    where: { workspaceId: wsId, contactId: contact.id }
  });
  if (!lead) {
    lead = await prisma.lead.create({
      data: {
        workspaceId: wsId,
        contactId: contact.id,
        status: status,
        source: source,
        ownerUserId: assignedUser?.id || null,
        score: score,
        category: category,
        scoreFactors: {
          engagementDepth: score > 70 ? 'High' : 'Moderate',
          formSubmitted: i % 2 === 0,
          verifiedPhone: true,
          budgetMatch: category === 'HOT',
        },
        notes: `Inbound prospect from ${source}. Interested in growth offerings and portfolio expansion.`,
        customFields: {
          investmentTimeline: i % 2 === 0 ? 'Within 30 days' : '1-3 months',
          estimatedTicketSize: category === 'HOT' ? '₹25,00,000' : '₹10,00,000',
        },
        createdAt: new Date(Date.now() - (50 - i) * 6 * 3600 * 1000),
      }
    });
  }

  // C. Form Submission for every second lead
  if (i % 2 === 0 && leadForm) {
    await prisma.leadFormSubmission.create({
      data: {
        workspaceId: wsId,
        formId: leadForm.id,
        contactId: contact.id,
        leadId: lead.id,
        answers: {
          allocation_size: category === 'HOT' ? '₹50L - ₹1Cr' : '₹10L - ₹25L',
          timeline: category === 'HOT' ? 'Immediate (1-2 weeks)' : '1-3 Months',
          investment_goals: 'Capital appreciation and high-yield quarterly distributions.',
        },
        outcome: 'CREATED',
        createdAt: new Date(Date.now() - (50 - i) * 5 * 3600 * 1000),
      }
    }).catch(() => {});
  }

  // D. Engagement / CrmActivity
  const actType = ACTIVITY_TYPES[i % ACTIVITY_TYPES.length];
  const engStatus = i % 3 === 0 ? 'Completed' : i % 3 === 1 ? 'Active' : 'Scheduled';
  const durationMins = actType === 'CALL' || actType === 'VIDEO_CALL' ? 10 + (i % 35) : null;

  await prisma.crmActivity.create({
    data: {
      workspaceId: wsId,
      leadId: lead.id,
      contactId: contact.id,
      type: actType === 'VIDEO_CALL' || actType === 'VISITS' ? 'MEETING' : actType === 'MESSAGES' ? 'EMAIL' : actType === 'NOTE' ? 'NOTE' : 'CALL',
      content: JSON.stringify({
        engagementType: actType === 'VIDEO_CALL' ? 'Video Call' : actType === 'VISITS' ? 'Visit' : actType === 'MESSAGES' ? 'Message' : actType === 'CALL' ? 'Call' : 'Meeting',
        status: engStatus,
        duration: durationMins,
        notes: `Conducted initial discovery discussion with ${fullName}. Discussed portfolio criteria and operational terms.`,
        source: source,
      }),
      createdByUserId: assignedUser?.id || null,
      createdAt: new Date(Date.now() - (50 - i) * 4 * 3600 * 1000),
    }
  }).catch(() => {});

  // E. Task for active/qualified leads
  if (status === 'QUALIFIED' || status === 'CONTACTED') {
    const isOverdue = i % 4 === 0;
    const isCompleted = i % 3 === 0;
    const dueDate = isOverdue
      ? new Date(Date.now() - 2 * 86400000)
      : new Date(Date.now() + ((i % 7) + 1) * 86400000);

    await prisma.task.create({
      data: {
        workspaceId: wsId,
        leadId: lead.id,
        contactId: contact.id,
        assignedToUserId: assignedUser?.id || null,
        title: i % 2 === 0 ? `Follow-up call with ${fullName}` : `Send Term Sheet & KYC Docs to ${fullName}`,
        description: `Review requirements from ${source} chat and finalize next steps.`,
        status: isCompleted ? 'COMPLETED' : 'PENDING',
        dueDate: dueDate,
        completedAt: isCompleted ? new Date() : null,
        createdAt: new Date(Date.now() - (50 - i) * 3 * 3600 * 1000),
      }
    }).catch(() => {});
  }

  // F. Deal for Hot/Qualified leads
  if (category === 'HOT' || status === 'QUALIFIED') {
    const dealStage = DEAL_STAGES[i % DEAL_STAGES.length];
    const dealValue = (i + 1) * 75000 + 150000;

    await prisma.deal.create({
      data: {
        workspaceId: wsId,
        leadId: lead.id,
        contactId: contact.id,
        ownerUserId: assignedUser?.id || null,
        title: `${fullName} - Growth Portfolio Allotment`,
        value: dealValue,
        currency: 'INR',
        stage: dealStage,
        expectedCloseDate: new Date(Date.now() + ((i % 20) + 5) * 86400000),
        closedAt: dealStage === 'CLOSED_WON' ? new Date() : null,
        lostReason: dealStage === 'CLOSED_LOST' ? 'Postponed allocation to next fiscal year' : null,
        createdAt: new Date(Date.now() - (50 - i) * 2 * 3600 * 1000),
      }
    }).catch(() => {});
  }

  // G. Conversation & Messages in CRM Inbox
  if (i < 20) {
    const conv = await prisma.conversation.create({
      data: {
        workspaceId: wsId,
        contactId: contact.id,
        status: i % 4 === 0 ? 'RESOLVED' : 'OPEN',
        unreadCount: i % 3 === 0 ? 1 : 0,
        assignedToUserId: assignedUser?.id || null,
        lastMessageAt: new Date(Date.now() - (25 - i) * 3600 * 1000),
        lastInboundAt: new Date(Date.now() - (25 - i) * 3600 * 1000),
      }
    }).catch(() => null);

    if (conv) {
      await prisma.message.create({
        data: {
          conversationId: conv.id,
          body: `Hi, I came across your offering on ${source}. Could you share the terms and eligibility for new accounts?`,
          direction: 'INBOUND',
          type: 'TEXT',
          status: 'DELIVERED',
          createdAt: new Date(Date.now() - (25 - i) * 3600 * 1000 - 600000),
        }
      }).catch(() => {});

      await prisma.message.create({
        data: {
          conversationId: conv.id,
          body: `Hello ${fn}! Thank you for reaching out. Yes, we have our latest prospectus ready. What is your estimated allocation timeline?`,
          direction: 'OUTBOUND',
          type: 'TEXT',
          status: 'READ',
          senderUserId: assignedUser?.id || null,
          createdAt: new Date(Date.now() - (25 - i) * 3600 * 1000),
        }
      }).catch(() => {});
    }
  }
}

async function seedWorkspace(workspace, users) {
  const wsId = workspace.id;
  const wsName = workspace.name;
  console.log(`\n▶ Seeding CRM data for: "${wsName}" (${wsId})`);

  const repUsers = users.length > 0 ? users : [null];
  const primaryUser = repUsers[0];

  // 1. Ensure Team exists
  let team = await prisma.team.findFirst({ where: { workspaceId: wsId } });
  if (!team) {
    team = await prisma.team.create({
      data: {
        workspaceId: wsId,
        name: 'Enterprise Growth Team',
        description: 'Direct sales and inbound lead acceleration',
      }
    });
    if (primaryUser) {
      await prisma.teamMember.create({
        data: {
          teamId: team.id,
          userId: primaryUser.id,
          role: 'LEAD',
        }
      }).catch(() => {});
    }
  }

  // 2. Ensure LeadForm exists
  let leadForm = await prisma.leadForm.findFirst({ where: { workspaceId: wsId } });
  if (!leadForm) {
    leadForm = await prisma.leadForm.create({
      data: {
        workspaceId: wsId,
        name: 'VIP Investor Application',
        slug: `vip-investor-${Date.now().toString().slice(-4)}`,
        ownerUserId: primaryUser?.id || null,
        fields: [
          { name: 'name', label: 'Full Name', type: 'text', required: true },
          { name: 'phone', label: 'WhatsApp Number', type: 'phone', required: true },
          { name: 'email', label: 'Work Email', type: 'email', required: false },
          { name: 'allocation_size', label: 'Target Allocation Size', type: 'select', options: ['₹10L - ₹25L', '₹25L - ₹50L', '₹50L - ₹1Cr', '₹1Cr+'], required: true },
          { name: 'timeline', label: 'Investment Timeline', type: 'select', options: ['Immediate', '1-3 Months', 'Exploring'], required: true },
        ],
        isActive: true,
      }
    }).catch(() => null);
  }

  // 3. Process 50 leads in chunks of 5
  const CONCURRENCY = 5;
  for (let i = 0; i < 50; i += CONCURRENCY) {
    const chunk = [];
    for (let j = 0; j < CONCURRENCY && (i + j) < 50; j++) {
      chunk.push(seedSingleLead(i + j, wsId, repUsers, leadForm));
    }
    await Promise.all(chunk);
    console.log(`  ✓ [${wsName}] Seeded ${Math.min(i + CONCURRENCY, 50)}/50 leads + pipeline data`);
  }

  const [leadCount, dealCount, taskCount, actCount] = await Promise.all([
    prisma.lead.count({ where: { workspaceId: wsId } }),
    prisma.deal.count({ where: { workspaceId: wsId } }),
    prisma.task.count({ where: { workspaceId: wsId } }),
    prisma.crmActivity.count({ where: { workspaceId: wsId } }),
  ]);

  console.log(`  🎉 Final counts for "${wsName}": ${leadCount} Leads, ${dealCount} Deals, ${taskCount} Tasks, ${actCount} Engagements`);
}

async function main() {
  console.log('====================================================');
  console.log(' CRM Pipeline Data Seeder: 50 Leads + Full Funnel  ');
  console.log('====================================================');

  const activeMembers = await prisma.workspaceMember.findMany({
    include: {
      workspace: true,
      user: true,
    }
  });

  const workspaceMap = new Map();
  for (const m of activeMembers) {
    if (!workspaceMap.has(m.workspaceId)) {
      workspaceMap.set(m.workspaceId, {
        workspace: m.workspace,
        users: [],
      });
    }
    if (m.user) {
      workspaceMap.get(m.workspaceId).users.push(m.user);
    }
  }

  const targetIds = [
    'cmrt8hesi000l5lejtvocvic7', // Sampada Kulkarni's Workspace
  ];

  const targets = [];
  for (const id of targetIds) {
    if (workspaceMap.has(id)) {
      targets.push(workspaceMap.get(id));
    } else {
      const ws = await prisma.workspace.findUnique({ where: { id } });
      if (ws) {
        const users = await prisma.user.findMany({ take: 3 });
        targets.push({ workspace: ws, users });
      }
    }
  }

  console.log(`Targeting ${targets.length} primary active workspaces:`);
  for (const t of targets) {
    console.log(` - ${t.workspace.name} (${t.workspace.id})`);
  }

  for (const entry of targets) {
    try {
      await seedWorkspace(entry.workspace, entry.users);
    } catch (err) {
      console.error(`Failed to seed workspace ${entry.workspace.id}:`, err);
    }
  }

  console.log('\n====================================================');
  console.log(' ✓ Seeding Complete! All CRM pipelines now populated.');
  console.log('====================================================');
  process.exit(0);
}

main().catch((err) => {
  console.error('Seeding error:', err);
  process.exit(1);
});
