import { prisma } from '../lib/prisma.js';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const clampDays = (value) => {
  const days = Number.parseInt(value, 10);
  return [7, 30, 90].includes(days) ? days : 30;
};

const percent = (part, total) => (total > 0 ? +((part / total) * 100).toFixed(1) : 0);

const toIsoDay = (date) => date.toISOString().slice(0, 10);

// Average of (eventAt - sentAt) across campaign recipients that have both
// timestamps. Returns milliseconds (0 when there is nothing to average).
const averageLatencyMs = (items, field) => {
  const latencies = items
    .filter((item) => item.sentAt && item[field])
    .map((item) => item[field].getTime() - item.sentAt.getTime())
    .filter((value) => value >= 0);

  if (!latencies.length) return 0;
  return Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length);
};

export async function getOverview(workspaceId) {
  const [totalMessages, totalCampaigns, totalContacts, optOuts, agg] = await Promise.all([
    prisma.message.count({ where: { conversation: { workspaceId } } }),
    prisma.campaign.count({ where: { workspaceId } }),
    prisma.contact.count({ where: { workspaceId } }),
    prisma.contact.count({ where: { workspaceId, optedOut: true } }),
    prisma.campaign.aggregate({
      where: { workspaceId },
      _sum: { sent: true, delivered: true, read: true, failed: true },
    }),
  ]);

  const sent      = agg._sum.sent      ?? 0;
  const delivered = agg._sum.delivered ?? 0;
  const read      = agg._sum.read      ?? 0;
  const failed    = agg._sum.failed    ?? 0;
  const messagesSent = totalMessages + sent; // outbound from inbox + campaign sends
  const deliveryRate = sent > 0 ? +((delivered / sent) * 100).toFixed(1) : 0;
  const optOutRate   = totalContacts > 0 ? +((optOuts / totalContacts) * 100).toFixed(1) : 0;

  return {
    messagesSent,
    totalCampaigns,
    totalContacts,
    optOuts,
    deliveryRate,        // number 0–100
    optOutRate,          // number 0–100
    sent,
    delivered,
    read,
    failed,
  };
}

export async function getDeliveryStats(workspaceId) {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    date.setHours(0, 0, 0, 0);
    const next = new Date(date);
    next.setDate(next.getDate() + 1);

    const [sent, delivered] = await Promise.all([
      prisma.campaignRecipient.count({
        where: { campaign: { workspaceId }, sentAt: { gte: date, lt: next } },
      }),
      prisma.campaignRecipient.count({
        where: { campaign: { workspaceId }, deliveredAt: { gte: date, lt: next } },
      }),
    ]);

    const rate = sent > 0 ? +((delivered / sent) * 100).toFixed(1) : 0;
    days.push({
      date: DAY_NAMES[date.getDay()],
      iso:  date.toISOString().split('T')[0],
      sent,
      delivered,
      rate, // number 0–100
    });
  }
  return days;
}

export async function getCampaignStats(workspaceId) {
  return prisma.campaign.findMany({
    where: { workspaceId },
    select: { id: true, name: true, sent: true, delivered: true, read: true, failed: true, totalContacts: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 8,
  });
}

export async function getAgentStats(workspaceId) {
  const members = await prisma.workspaceMember.findMany({
    where: { workspaceId },
    include: { user: { select: { id: true, name: true } } },
  });

  return Promise.all(
    members.map(async (m) => {
      const chatsHandled = await prisma.message.count({
        where: { senderUserId: m.userId, conversation: { workspaceId } },
      });
      return { agentId: m.userId, name: m.user.name, chatsHandled };
    })
  );
}

// ─── Chat analysis ───────────────────────────────────────────────────────────
// Aggregates messages, conversations, campaigns, contacts and top agents for a
// workspace over the last N days (7 / 30 / 90). Everything uses normal Prisma
// queries scoped to workspaceId; only the per-day message volume uses a raw
// query because Prisma has no portable DATE() grouping helper.
export async function getChatAnalytics(workspaceId, daysParam = 30) {
  const days = clampDays(daysParam);
  const startDate = new Date();
  startDate.setUTCHours(0, 0, 0, 0);
  startDate.setUTCDate(startDate.getUTCDate() - (days - 1));

  // Messages in this workspace within the date window. All message-based
  // counts below reuse this filter.
  const messageWhere = {
    sentAt: { gte: startDate },
    conversation: { workspaceId },
  };

  const [
    messageDirections,     // OUTBOUND vs INBOUND totals
    botOutboundMessages,   // outbound with no human sender (bot / automation)
    manualOutboundMessages,// outbound sent by a human agent
    conversationStatuses,  // OPEN / RESOLVED / PENDING counts
    labelGroups,           // conversation label distribution
    openUnreadAverage,     // avg unreadCount for OPEN conversations
    campaignTotals,        // sum of sent/delivered/read/failed counters
    campaignRecipients,    // for delivery + read latency
    contactsTotal,
    contactsOptedOut,
    topAgentGroups,        // outbound grouped by senderUserId
    dailyRows,             // raw per-day volume (the only $queryRaw usage)
  ] = await Promise.all([
    prisma.message.groupBy({
      by: ['direction'],
      where: messageWhere,
      _count: { _all: true },
    }),
    prisma.message.count({
      where: { ...messageWhere, direction: 'OUTBOUND', senderUserId: null },
    }),
    prisma.message.count({
      where: { ...messageWhere, direction: 'OUTBOUND', senderUserId: { not: null } },
    }),
    prisma.conversation.groupBy({
      by: ['status'],
      where: { workspaceId },
      _count: { _all: true },
    }),
    prisma.conversation.groupBy({
      by: ['label'],
      where: { workspaceId },
      _count: { _all: true },
    }),
    prisma.conversation.aggregate({
      where: { workspaceId, status: 'OPEN' },
      _avg: { unreadCount: true },
    }),
    prisma.campaign.aggregate({
      where: { workspaceId },
      _sum: { sent: true, delivered: true, read: true, failed: true },
    }),
    prisma.campaignRecipient.findMany({
      where: {
        campaign: { workspaceId },
        sentAt: { not: null },
        OR: [{ deliveredAt: { not: null } }, { readAt: { not: null } }],
      },
      select: { sentAt: true, deliveredAt: true, readAt: true },
    }),
    prisma.contact.count({ where: { workspaceId } }),
    prisma.contact.count({ where: { workspaceId, optedOut: true } }),
    prisma.message.groupBy({
      by: ['senderUserId'],
      where: {
        ...messageWhere,
        direction: 'OUTBOUND',
        senderUserId: { not: null },
      },
      _count: { senderUserId: true },
      orderBy: { _count: { senderUserId: 'desc' } },
      take: 5,
    }),
    prisma.$queryRaw`
      SELECT
        DATE(m."sentAt")::text AS date,
        COUNT(*) FILTER (WHERE m."direction" = 'OUTBOUND')::int AS sent,
        COUNT(*) FILTER (WHERE m."direction" = 'INBOUND')::int AS received
      FROM "Message" m
      INNER JOIN "Conversation" c ON c."id" = m."conversationId"
      WHERE c."workspaceId" = ${workspaceId}
        AND m."sentAt" >= ${startDate}
      GROUP BY DATE(m."sentAt")
      ORDER BY DATE(m."sentAt") ASC
    `,
  ]);

  const statusCount = (status) =>
    conversationStatuses.find((row) => row.status === status)?._count._all ?? 0;

  // Resolve agent names for the top-senders list (only when we have results).
  const users = topAgentGroups.length
    ? await prisma.user.findMany({
        where: { id: { in: topAgentGroups.map((agent) => agent.senderUserId) } },
        select: { id: true, name: true },
      })
    : [];
  const usersById = new Map(users.map((user) => [user.id, user]));

  // Zero-fill the daily series across the full date window so the chart is
  // continuous even on days with no activity.
  const dailyByDate = new Map(
    dailyRows.map((row) => [
      row.date,
      {
        date: row.date,
        sent: Number(row.sent ?? 0),
        received: Number(row.received ?? 0),
      },
    ])
  );
  const dailyVolume = [];
  for (let i = 0; i < days; i += 1) {
    const date = new Date(startDate);
    date.setUTCDate(startDate.getUTCDate() + i);
    const iso = toIsoDay(date);
    dailyVolume.push(dailyByDate.get(iso) ?? { date: iso, sent: 0, received: 0 });
  }

  const campaignSent      = campaignTotals._sum.sent      ?? 0;
  const campaignDelivered = campaignTotals._sum.delivered ?? 0;
  const campaignRead      = campaignTotals._sum.read      ?? 0;
  const campaignFailed    = campaignTotals._sum.failed    ?? 0;

  const directionCounts = messageDirections.reduce((acc, row) => {
    acc[row.direction] = row._count._all;
    return acc;
  }, {});

  return {
    days,
    range: { from: toIsoDay(startDate), to: toIsoDay(new Date()) },
    messages: {
      sent: directionCounts.OUTBOUND ?? 0,
      received: directionCounts.INBOUND ?? 0,
      bot: botOutboundMessages,
      manual: manualOutboundMessages,
    },
    conversations: {
      open: statusCount('OPEN'),
      resolved: statusCount('RESOLVED'),
      pending: statusCount('PENDING'),
      labels: labelGroups
        .map((row) => ({
          label: row.label || 'Unlabeled',
          count: row._count._all,
        }))
        .sort((a, b) => b.count - a.count),
      averageUnreadOpen: +(openUnreadAverage._avg.unreadCount ?? 0).toFixed(1),
    },
    campaigns: {
      sent: campaignSent,
      delivered: campaignDelivered,
      read: campaignRead,
      failed: campaignFailed,
      deliveryRate: percent(campaignDelivered, campaignSent),
      readRate: percent(campaignRead, campaignSent),
      failedRate: percent(campaignFailed, campaignSent),
      deliveryLatencyMs: averageLatencyMs(campaignRecipients, 'deliveredAt'),
      readLatencyMs: averageLatencyMs(campaignRecipients, 'readAt'),
    },
    contacts: {
      total: contactsTotal,
      optedOut: contactsOptedOut,
      optOutRate: percent(contactsOptedOut, contactsTotal),
    },
    topAgents: topAgentGroups.map((agent) => ({
      agentId: agent.senderUserId,
      name: usersById.get(agent.senderUserId)?.name || 'Unknown agent',
      messageCount: agent._count.senderUserId,
    })),
    dailyVolume,
  };
}
