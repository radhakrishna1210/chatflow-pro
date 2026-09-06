import { prisma } from '../lib/prisma.js';
import { createCampaign, setRecipients, launchCampaign } from './campaigns.service.js';
import { normalizePhone } from './contacts.service.js';

const MIN_MSISDN_DIGITS = 8;
const MAX_MSISDN_DIGITS = 15;

const isSendableNumber = (phone) => {
  if (!phone) return false;
  const digits = normalizePhone(phone);
  return digits.length >= MIN_MSISDN_DIGITS && digits.length <= MAX_MSISDN_DIGITS;
};

/**
 * Get dynamic lead counts across categories and common segment filters.
 */
export async function getInboxSegments(workspaceId) {
  const [hotCount, warmCount, coldCount, totalCount, sources] = await Promise.all([
    prisma.lead.count({ where: { workspaceId, category: 'HOT' } }),
    prisma.lead.count({ where: { workspaceId, category: 'WARM' } }),
    prisma.lead.count({ where: { workspaceId, category: 'COLD' } }),
    prisma.lead.count({ where: { workspaceId } }),
    prisma.lead.groupBy({
      by: ['source'],
      where: { workspaceId, source: { not: null } },
      _count: { _all: true },
    }),
  ]);

  return {
    categories: {
      HOT: hotCount,
      WARM: warmCount,
      COLD: coldCount,
      ALL: totalCount,
    },
    sources: sources.map((s) => ({ source: s.source, count: s._count._all })),
  };
}

/**
 * Dynamic resolution of segment audience with detailed exclusion breakdown.
 */
export async function reviewSegmentAudience(workspaceId, { category = '', source = '', status = '', search = '' } = {}) {
  const where = {
    workspaceId,
    ...(category && category !== 'ALL' ? { category } : {}),
    ...(status ? { status } : {}),
    ...(source ? { source: { contains: source, mode: 'insensitive' } } : {}),
    ...(search ? {
      contact: {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { phoneNumber: { contains: search } },
          { email: { contains: search, mode: 'insensitive' } },
        ],
      },
    } : {}),
  };

  const leads = await prisma.lead.findMany({
    where,
    orderBy: [{ score: 'desc' }, { createdAt: 'desc' }],
    include: {
      contact: {
        select: { id: true, name: true, phoneNumber: true, email: true, optedOut: true, tags: true },
      },
      LeadFormSubmission: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { answers: true, createdAt: true },
      },
    },
  });

  let eligibleCount = 0;
  let optedOutCount = 0;
  let invalidPhoneCount = 0;

  const resolvedLeads = leads.map((l) => {
    const phoneValid = isSendableNumber(l.contact.phoneNumber);
    const optedOut = l.contact.optedOut === true;

    let isEligible = true;
    let exclusionReason = null;

    if (optedOut) {
      isEligible = false;
      exclusionReason = 'OPTED_OUT';
      optedOutCount++;
    } else if (!phoneValid) {
      isEligible = false;
      exclusionReason = 'INVALID_PHONE';
      invalidPhoneCount++;
    } else {
      eligibleCount++;
    }

    const latestSubmission = l.LeadFormSubmission?.[0];

    return {
      id: l.id,
      contactId: l.contactId,
      name: l.contact.name,
      phoneNumber: l.contact.phoneNumber,
      email: l.contact.email,
      status: l.status,
      category: l.category || 'COLD',
      categoryReasons: l.categoryReasons || [],
      score: l.score,
      source: l.source || 'Direct',
      latestFormAnswer: latestSubmission ? latestSubmission.answers : null,
      isEligible,
      exclusionReason,
    };
  });

  return {
    matchingCount: leads.length,
    eligibleCount,
    excludedCount: optedOutCount + invalidPhoneCount,
    exclusions: {
      optedOutCount,
      invalidPhoneCount,
    },
    leads: resolvedLeads,
  };
}

/**
 * Launch bulk campaign targeting dynamic CRM lead segment audience.
 */
export async function launchSegmentCampaign(workspaceId, { name, category, source, status, templateId, waNumberId }, user = null) {
  const audience = await reviewSegmentAudience(workspaceId, { category, source, status });
  const eligibleLeads = audience.leads.filter((l) => l.isEligible);

  if (eligibleLeads.length === 0) {
    const e = new Error('No eligible contacts found in the selected segment for WhatsApp delivery');
    e.status = 400; throw e;
  }

  const campaignName = name || `CRM Segment (${category || 'ALL'}) - ${new Date().toLocaleDateString('en-US')}`;

  // 1. Create campaign draft
  const campaign = await createCampaign(workspaceId, {
    name: campaignName,
    templateId,
    waNumberId,
    goal: `CRM Segment Campaign (${category || 'ALL'})`,
  }, user);

  // 2. Set recipients
  const contactIds = eligibleLeads.map((l) => l.contactId);
  await setRecipients(workspaceId, campaign.id, contactIds);

  // 3. Launch campaign via existing campaign execution engine
  const launched = await launchCampaign(workspaceId, campaign.id, user);

  return {
    campaign: launched,
    audienceSummary: {
      totalMatching: audience.matchingCount,
      eligibleSent: eligibleLeads.length,
      excluded: audience.excludedCount,
    },
  };
}
