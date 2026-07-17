import { prisma } from '../src/lib/prisma.js';

const PLANS = [
  {
    key: 'FREE',
    name: 'Free',
    priceMonthly: 0,
    messageQuota: 100,
    contactLimit: 100,
    memberLimit: 1,
    campaignLimit: null,
    apiKeyLimit: 1,
    overageRatePerMsg: 0.02,
    features: {},
  },
  {
    key: 'STARTER',
    name: 'Starter',
    priceMonthly: 29,
    messageQuota: 2000,
    contactLimit: 2000,
    memberLimit: 3,
    campaignLimit: null,
    apiKeyLimit: 3,
    overageRatePerMsg: 0.015,
    features: { automation: true },
  },
  {
    key: 'PRO',
    name: 'Pro',
    priceMonthly: 99,
    messageQuota: 10000,
    contactLimit: null,
    memberLimit: 10,
    campaignLimit: null,
    apiKeyLimit: 10,
    overageRatePerMsg: 0.01,
    features: { automation: true, workflows: true, aiOnboarding: true, integrations: true },
  },
  {
    key: 'ENTERPRISE',
    name: 'Enterprise',
    priceMonthly: 299,
    messageQuota: -1,
    contactLimit: null,
    memberLimit: null,
    campaignLimit: null,
    apiKeyLimit: null,
    overageRatePerMsg: 0.008,
    features: { automation: true, workflows: true, aiOnboarding: true, integrations: true },
  },
];

async function main() {
  for (const plan of PLANS) {
    const { key, ...data } = plan;
    const result = await prisma.plan.upsert({
      where: { key },
      update: data,
      create: { key, ...data },
    });
    console.log(`Upserted plan: ${result.key}`);
  }
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
