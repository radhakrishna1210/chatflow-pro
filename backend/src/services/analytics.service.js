import { prisma } from '../lib/prisma.js';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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
