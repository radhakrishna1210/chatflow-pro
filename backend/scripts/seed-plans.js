import { prisma } from '../src/lib/prisma.js';
// One catalogue, shared with the boot-time upsert in src/server.js.
import { PLANS, RETIRED_PLAN_SUCCESSOR } from '../src/data/planCatalog.js';

const RETIRED_PLAN_KEYS = Object.keys(RETIRED_PLAN_SUCCESSOR);

async function main() {
  const planByKey = new Map();
  for (const plan of PLANS) {
    const { key, ...data } = plan;
    const result = await prisma.plan.upsert({
      where: { key },
      update: data,
      create: { key, ...data },
    });
    planByKey.set(result.key, result);
    console.log(`Upserted plan: ${result.key}`);
  }

  // Deactivated rather than deleted: Subscription.planId still references
  // these rows. Subscribers move to the successor plan first so nothing is
  // left pointing at a plan that can no longer be renewed or displayed.
  const retired = await prisma.plan.findMany({
    where: { key: { in: RETIRED_PLAN_KEYS } },
    select: { id: true, key: true },
  });
  if (retired.length > 0) {
    const movedPerPlan = [];
    for (const oldPlan of retired) {
      const successor = planByKey.get(RETIRED_PLAN_SUCCESSOR[oldPlan.key]);
      if (!successor) continue;
      const moved = await prisma.subscription.updateMany({
        where: { planId: oldPlan.id },
        data: { planId: successor.id },
      });
      if (moved.count > 0) movedPerPlan.push(`${moved.count} ${oldPlan.key}→${successor.key}`);
    }
    const retiredIds = retired.map((p) => p.id);
    const clearedPending = await prisma.subscription.updateMany({
      where: { pendingPlanId: { in: retiredIds } },
      data: { pendingPlanId: null },
    });
    await prisma.plan.updateMany({
      where: { id: { in: retiredIds } },
      data: { isActive: false },
    });
    console.log(`Retired ${retired.map((p) => p.key).join(', ')} — moved ${movedPerPlan.join(', ') || 'none'}, cleared ${clearedPending.count} pending change(s).`);
  }
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
