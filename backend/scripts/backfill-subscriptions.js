import { prisma } from '../src/lib/prisma.js';

const CYCLE_DAYS = 30;

async function main() {
  const plans = await prisma.plan.findMany();
  const planByKey = new Map(plans.map(p => [p.key, p]));
  const freePlan = planByKey.get('FREE');
  if (!freePlan) {
    console.error('FREE plan not found — run seed-plans.js first.');
    process.exit(1);
  }

  const workspaces = await prisma.workspace.findMany({
    select: { id: true, plan: true, subscription: true },
  });

  let created = 0;
  for (const ws of workspaces) {
    if (ws.subscription) continue;

    const plan = planByKey.get(ws.plan) || freePlan;
    const currentPeriodStart = new Date();
    const currentPeriodEnd = new Date(currentPeriodStart.getTime() + CYCLE_DAYS * 24 * 60 * 60 * 1000);

    await prisma.subscription.create({
      data: {
        workspaceId: ws.id,
        planId: plan.id,
        status: 'ACTIVE',
        currentPeriodStart,
        currentPeriodEnd,
      },
    });

    await prisma.usageCounter.upsert({
      where: { workspaceId_periodStart: { workspaceId: ws.id, periodStart: currentPeriodStart } },
      update: {},
      create: {
        workspaceId: ws.id,
        periodStart: currentPeriodStart,
        periodEnd: currentPeriodEnd,
        messagesUsed: 0,
      },
    });

    created += 1;
    console.log(`Backfilled subscription for workspace ${ws.id} -> plan ${plan.key}`);
  }

  console.log(`Done. Created ${created} subscription(s). ${workspaces.length - created} already had one.`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
