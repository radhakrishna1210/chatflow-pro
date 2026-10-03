import { prisma } from '../lib/prisma.js';
import { forEachChunk } from '../lib/paging.js';
import { createCampaign, setRecipients, launchCampaign } from './campaigns.service.js';
import { normalizePhone } from './contacts.service.js';
import { scopeFilter, withScope } from './recordScope.service.js';
import { PRISMA_LEAD_STATUSES } from './leads.service.js';

const MIN_MSISDN_DIGITS = 8;
const MAX_MSISDN_DIGITS = 15;

const isSendableNumber = (phone) => {
  if (!phone) return false;
  const digits = normalizePhone(phone);
  return digits.length >= MIN_MSISDN_DIGITS && digits.length <= MAX_MSISDN_DIGITS;
};

// The review screen shows this many leads; counts always cover the whole
// segment. Shipping every lead (with its form answers) on each tab open was a
// 50k-row response for a large workspace.
export const AUDIENCE_PREVIEW_LIMIT = 200;

// Campaigns launched from here carry this goal prefix, which is what the
// segment analytics filter on.
const SEGMENT_GOAL_PREFIX = 'CRM Segment Campaign';

// Custom lifecycle keys live in customFields, not the LeadStatus enum; passing
// one to the enum column failed the review and the launch with a 500.
const statusClause = (status) => (PRISMA_LEAD_STATUSES.has(status)
  ? { status }
  : { customFields: { path: ['statusKey'], equals: status } });

// Segments are lists of leads, so record visibility applies exactly as it does
// to the lead list: an OWN/TEAM member reviews and messages only their own.
async function segmentWhere(workspaceId, { category = '', source = '', status = '', search = '' } = {}, user = null) {
  const scope = user ? await scopeFilter(workspaceId, user) : {};
  return withScope({
    workspaceId,
    ...(category && category !== 'ALL' ? { category } : {}),
    ...(status ? statusClause(status) : {}),
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
  }, scope);
}

/**
 * Get dynamic lead counts across categories and common segment filters.
 */
export async function getInboxSegments(workspaceId, user = null) {
  const scope = user ? await scopeFilter(workspaceId, user) : {};
  const scoped = (where) => withScope({ workspaceId, ...where }, scope);
  const [hotCount, warmCount, coldCount, totalCount, sources] = await Promise.all([
    prisma.lead.count({ where: scoped({ category: 'HOT' }) }),
    prisma.lead.count({ where: scoped({ category: 'WARM' }) }),
    prisma.lead.count({ where: scoped({ category: 'COLD' }) }),
    prisma.lead.count({ where: scoped({}) }),
    prisma.lead.groupBy({
      by: ['source'],
      where: scoped({ source: { not: null } }),
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

// Opted out is reported first: it is the reason the sender most needs to see.
function exclusionReason(contact) {
  if (contact?.optedOut === true) return 'OPTED_OUT';
  if (!isSendableNumber(contact?.phoneNumber)) return 'INVALID_PHONE';
  return null;
}

// Every lead in the segment, reduced to what eligibility needs. This stays on
// the server; the browser only receives the preview.
// Read in chunks (CF-048); only the eligible ids are kept.
async function resolveAudience(where) {
  const eligibleContactIds = [];
  let matchingCount = 0;
  let optedOutCount = 0;
  let invalidPhoneCount = 0;
  await forEachChunk(prisma.lead, {
    where,
    select: { contactId: true, contact: { select: { phoneNumber: true, optedOut: true } } },
  }, (rows) => {
    matchingCount += rows.length;
    for (const r of rows) {
      const reason = exclusionReason(r.contact);
      if (reason === 'OPTED_OUT') optedOutCount++;
      else if (reason === 'INVALID_PHONE') invalidPhoneCount++;
      else eligibleContactIds.push(r.contactId);
    }
  });
  return { matchingCount, eligibleContactIds, optedOutCount, invalidPhoneCount };
}

/**
 * Dynamic resolution of segment audience with detailed exclusion breakdown.
 * Counts cover the whole segment; `leads` is the first AUDIENCE_PREVIEW_LIMIT.
 */
export async function reviewSegmentAudience(workspaceId, filters = {}, user = null) {
  const where = await segmentWhere(workspaceId, filters, user);

  const [audience, preview] = await Promise.all([
    resolveAudience(where),
    prisma.lead.findMany({
      where,
      orderBy: [{ score: 'desc' }, { createdAt: 'desc' }],
      take: AUDIENCE_PREVIEW_LIMIT,
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
    }),
  ]);

  const leads = preview.map((l) => {
    const reason = exclusionReason(l.contact);
    const latestSubmission = l.LeadFormSubmission?.[0];
    return {
      id: l.id,
      contactId: l.contactId,
      name: l.contact.name,
      phoneNumber: l.contact.phoneNumber,
      email: l.contact.email,
      status: l.customFields?.statusKey || l.status,
      category: l.category || 'COLD',
      categoryReasons: l.categoryReasons || [],
      score: l.score,
      source: l.source || 'Direct',
      latestFormAnswer: latestSubmission ? latestSubmission.answers : null,
      isEligible: reason === null,
      exclusionReason: reason,
    };
  });

  return {
    matchingCount: audience.matchingCount,
    eligibleCount: audience.eligibleContactIds.length,
    excludedCount: audience.optedOutCount + audience.invalidPhoneCount,
    exclusions: {
      optedOutCount: audience.optedOutCount,
      invalidPhoneCount: audience.invalidPhoneCount,
    },
    leads,
    previewLimit: AUDIENCE_PREVIEW_LIMIT,
    truncated: audience.matchingCount > leads.length,
  };
}

/**
 * Launch bulk campaign targeting dynamic CRM lead segment audience, through
 * the normal campaign engine (billing, plan limits, opt-out checks).
 */
export async function launchSegmentCampaign(workspaceId, { name, category, source, status, templateId, waNumberId }, user = null) {
  const where = await segmentWhere(workspaceId, { category, source, status }, user);
  const audience = await resolveAudience(where);

  if (audience.eligibleContactIds.length === 0) {
    const e = new Error('No eligible contacts found in the selected segment for WhatsApp delivery');
    e.status = 400; throw e;
  }

  const campaignName = name || `CRM Segment (${category || 'ALL'}) - ${new Date().toLocaleDateString('en-US')}`;

  // 1. Create campaign draft. createCampaign reads the number as `numberId`;
  // passing `waNumberId` left it undefined and silently used any number.
  const campaign = await createCampaign(workspaceId, {
    name: campaignName,
    templateId,
    numberId: waNumberId,
    goal: `${SEGMENT_GOAL_PREFIX} (${category || 'ALL'})`,
  }, user);

  try {
    // 2. Set recipients, 3. launch via the existing campaign execution engine.
    await setRecipients(workspaceId, campaign.id, audience.eligibleContactIds);
    const launched = await launchCampaign(workspaceId, campaign.id, null, null, user);

    return {
      campaign: launched,
      audienceSummary: {
        totalMatching: audience.matchingCount,
        eligibleSent: audience.eligibleContactIds.length,
        excluded: audience.optedOutCount + audience.invalidPhoneCount,
      },
    };
  } catch (err) {
    // A launch refused for wallet, template or plan reasons would otherwise
    // leave a DRAFT holding the whole recipient list, one more per retry. Only
    // an unlaunched, uncharged draft is removed.
    await prisma.campaign.deleteMany({
      where: { id: campaign.id, workspaceId, status: 'DRAFT', chargedAt: null },
    }).catch((e) => console.error('[CrmSalesInbox] Could not remove draft after failed launch:', e.message));
    throw err;
  }
}

/**
 * Get delivery, read, and failure analytics across CRM broadcast campaigns.
 */
export async function getSegmentCampaignAnalytics(workspaceId) {
  const campaigns = await prisma.campaign.findMany({
    where: {
      workspaceId,
      goal: { startsWith: SEGMENT_GOAL_PREFIX },
    },
    orderBy: { createdAt: 'desc' },
    take: 15,
    select: {
      id: true,
      name: true,
      status: true,
      totalContacts: true,
      sent: true,
      delivered: true,
      read: true,
      failed: true,
      skipped: true,
      createdAt: true,
      launchedAt: true,
      completedAt: true,
    },
  });

  const enriched = campaigns.map((c) => {
    const total = c.totalContacts || c.sent || 0;
    const delivered = c.delivered || 0;
    const read = c.read || 0;
    const failed = c.failed || 0;

    const deliveryRate = total > 0 ? parseFloat(((delivered / total) * 100).toFixed(1)) : 0;
    const readRate = delivered > 0 ? parseFloat(((read / delivered) * 100).toFixed(1)) : 0;
    const failureRate = total > 0 ? parseFloat(((failed / total) * 100).toFixed(1)) : 0;

    return {
      ...c,
      audience: total,
      deliveryRate,
      readRate,
      failureRate,
      // Opt-outs, invalid numbers and other pre-send skips together; the
      // campaign row does not record which.
      skipped: c.skipped || 0,
    };
  });

  const totals = enriched.reduce((acc, cur) => {
    acc.totalAudience += cur.audience;
    acc.totalSent += cur.sent;
    acc.totalDelivered += cur.delivered;
    acc.totalRead += cur.read;
    acc.totalFailed += cur.failed;
    acc.totalSkipped += cur.skipped;
    return acc;
  }, { totalAudience: 0, totalSent: 0, totalDelivered: 0, totalRead: 0, totalFailed: 0, totalSkipped: 0 });

  const overallDeliveryRate = totals.totalAudience > 0 ? parseFloat(((totals.totalDelivered / totals.totalAudience) * 100).toFixed(1)) : 0;
  const overallReadRate = totals.totalDelivered > 0 ? parseFloat(((totals.totalRead / totals.totalDelivered) * 100).toFixed(1)) : 0;

  return {
    campaigns: enriched,
    summary: {
      ...totals,
      overallDeliveryRate,
      overallReadRate,
    },
  };
}
