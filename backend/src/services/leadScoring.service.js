import { prisma } from '../lib/prisma.js';

export const MAX_SCORE = 100;

// Pure: plain signals in, { score, maxScore, factors } out. No I/O, so the
// weighting can be unit tested without a database. Every factor carries its own
// explanation — a score with no stated reason is not actionable for a rep.
export function scoreLead(signals) {
  const {
    optedOut = false,
    daysSinceLastInboundMessage = null,
    inboundMessageCount = 0,
    campaignsSentCount = 0,
    campaignsReadCount = 0,
    hasOpenConversation = false,
    hasEmail = false,
    hasTags = false,
    daysSinceContactCreated = 0,
  } = signals ?? {};

  // An opted-out contact cannot legally be messaged, so no engagement signal
  // can make them a prospect. Short-circuit rather than let other factors
  // accumulate into a misleading score.
  if (optedOut) {
    return {
      score: 0,
      maxScore: MAX_SCORE,
      factors: [{
        key: 'optedOut',
        label: 'Opted out',
        points: 0,
        maxPoints: MAX_SCORE,
        detail: 'Contact has opted out of messaging — cannot be contacted.',
      }],
    };
  }

  const factors = [];

  let recencyPts = 0;
  let recencyDetail = 'No inbound reply yet';
  if (daysSinceLastInboundMessage != null) {
    if (daysSinceLastInboundMessage <= 1) { recencyPts = 30; recencyDetail = 'Replied within the last 24 hours'; }
    else if (daysSinceLastInboundMessage <= 7) { recencyPts = 20; recencyDetail = 'Replied within the last 7 days'; }
    else if (daysSinceLastInboundMessage <= 30) { recencyPts = 10; recencyDetail = 'Replied within the last 30 days'; }
    else { recencyDetail = `Last reply was ${daysSinceLastInboundMessage} days ago`; }
  }
  factors.push({ key: 'replyRecency', label: 'Reply recency', points: recencyPts, maxPoints: 30, detail: recencyDetail });

  const volumePts = inboundMessageCount >= 6 ? 20 : inboundMessageCount >= 3 ? 15 : inboundMessageCount >= 1 ? 8 : 0;
  factors.push({
    key: 'replyVolume',
    label: 'Reply volume',
    points: volumePts,
    maxPoints: 20,
    detail: `${inboundMessageCount} inbound message${inboundMessageCount === 1 ? '' : 's'} received`,
  });

  const readRatio = campaignsSentCount > 0 ? campaignsReadCount / campaignsSentCount : 0;
  const campaignPts = campaignsSentCount === 0 ? 0 : Math.round(readRatio * 20);
  factors.push({
    key: 'campaignEngagement',
    label: 'Campaign read rate',
    points: campaignPts,
    maxPoints: 20,
    detail: campaignsSentCount === 0
      ? 'No campaign messages sent yet'
      : `Read ${campaignsReadCount}/${campaignsSentCount} campaign messages`,
  });

  factors.push({
    key: 'activeConversation',
    label: 'Active conversation',
    points: hasOpenConversation ? 10 : 0,
    maxPoints: 10,
    detail: hasOpenConversation ? 'Has an open or pending conversation' : 'No open conversation',
  });

  factors.push({
    key: 'profileCompleteness',
    label: 'Profile completeness',
    points: (hasEmail ? 5 : 0) + (hasTags ? 5 : 0),
    maxPoints: 10,
    detail: `${hasEmail ? 'Has email' : 'No email'}, ${hasTags ? 'has tags' : 'no tags'}`,
  });

  const freshPts = daysSinceContactCreated <= 3 ? 10 : daysSinceContactCreated <= 7 ? 6 : daysSinceContactCreated <= 30 ? 3 : 0;
  factors.push({
    key: 'freshness',
    label: 'Freshness',
    points: freshPts,
    maxPoints: 10,
    detail: `Contact created ${daysSinceContactCreated} day${daysSinceContactCreated === 1 ? '' : 's'} ago`,
  });

  const score = factors.reduce((sum, f) => sum + f.points, 0);
  return { score: Math.min(MAX_SCORE, score), maxScore: MAX_SCORE, factors };
}

const DAY_MS = 86_400_000;

// Gathers the real signals for one contact from data this platform already
// records (messages, conversations, campaign recipients) and scores them.
export async function computeLeadScore(workspaceId, contactId) {
  const [contact, lastInbound, inboundCount, recipients, openConversation] = await Promise.all([
    prisma.contact.findFirst({ where: { id: contactId, workspaceId } }),
    prisma.message.findFirst({
      where: { direction: 'INBOUND', conversation: { contactId, workspaceId } },
      orderBy: { sentAt: 'desc' },
      select: { sentAt: true },
    }),
    prisma.message.count({ where: { direction: 'INBOUND', conversation: { contactId, workspaceId } } }),
    prisma.campaignRecipient.findMany({
      where: { contactId, campaign: { workspaceId } },
      select: { status: true, readAt: true },
    }),
    prisma.conversation.findFirst({
      where: { contactId, workspaceId, status: { in: ['OPEN', 'PENDING'] } },
      select: { id: true },
    }),
  ]);

  if (!contact) { const e = new Error('Contact not found'); e.status = 404; throw e; }

  const now = Date.now();
  const result = scoreLead({
    optedOut: contact.optedOut,
    daysSinceLastInboundMessage: lastInbound ? Math.floor((now - lastInbound.sentAt.getTime()) / DAY_MS) : null,
    inboundMessageCount: inboundCount,
    campaignsSentCount: recipients.filter((r) => ['SENT', 'DELIVERED', 'READ'].includes(r.status)).length,
    campaignsReadCount: recipients.filter((r) => r.status === 'READ' || r.readAt).length,
    hasOpenConversation: Boolean(openConversation),
    hasEmail: Boolean(contact.email),
    hasTags: contact.tags.length > 0,
    daysSinceContactCreated: Math.floor((now - contact.createdAt.getTime()) / DAY_MS),
  });

  return { ...result, computedAt: new Date() };
}
