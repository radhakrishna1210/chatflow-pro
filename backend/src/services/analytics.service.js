import { prisma } from '../lib/prisma.js';
import { validTimeZone, zonedDayKey, zonedDayWindow, weekdayOfKey } from '../lib/zonedTime.js';
import { forEachChunk, findManyChunked } from '../lib/paging.js';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const clampDays = (value) => {
  const days = Number.parseInt(value, 10);
  return [7, 30, 90].includes(days) ? days : 30;
};

// Analytics ranges are shorter and finer than the 7/30/90 the chat page uses:
// a campaign's whole life is often a single day.
const clampRangeDays = (value) => {
  const days = Number.parseInt(value, 10);
  return [1, 7, 14, 30, 90].includes(days) ? days : 14;
};

const percent = (part, total) => (total > 0 ? +((part / total) * 100).toFixed(1) : 0);

// Day buckets follow the workspace's own calendar (Settings -> Workspace), not
// the server's TZ or a hard-coded India.
async function workspaceTimeZone(workspaceId) {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { timezone: true } });
  return validTimeZone(ws?.timezone);
}

// A recipient the network accepted. FAILED/SKIPPED rows can carry a sentAt
// from an attempt and are not sends.
const SENT_STATUSES = ['SENT', 'DELIVERED', 'READ'];

export async function getOverview(workspaceId, daysParam) {
  const days = clampRangeDays(daysParam);
  // Local midnight `days - 1` days ago in the workspace's zone, so "7 days"
  // means seven whole days including today rather than a rolling 168 hours —
  // which is what the label promises.
  const timeZone = await workspaceTimeZone(workspaceId);
  const { since } = zonedDayWindow(days, timeZone);

  const [messagesSent, totalCampaigns, newContacts, totalContacts, optOuts, statusGroups] = await Promise.all([
    // Outbound only, and only within the range.
    //
    // This counted every Message row in the workspace and then added the
    // campaigns' own `sent` counters on top. The campaign worker writes a
    // Message row for each send, so campaign messages were already in the first
    // number and were counted twice — while inbound messages *from* customers
    // were being reported as messages the workspace had sent.
    prisma.message.count({
      where: { conversation: { workspaceId }, direction: 'OUTBOUND', sentAt: { gte: since } },
    }),
    prisma.campaign.count({ where: { workspaceId, createdAt: { gte: since } } }),
    // New contacts and opt-outs are "in this period", like every other figure
    // on the page; the opt-out rate is over the whole base, since anyone in it
    // could opt out — not over this period's sign-ups, which let it pass 100%.
    prisma.contact.count({ where: { workspaceId, createdAt: { gte: since } } }),
    prisma.contact.count({ where: { workspaceId } }),
    prisma.contact.count({ where: { workspaceId, optedOut: true, optedOutAt: { gte: since } } }),
    // Delivery outcomes come from the recipients themselves rather than
    // Campaign's denormalised counters, which are incremented from four
    // different files with no reconciliation and can drift.
    prisma.campaignRecipient.groupBy({
      by: ['status'],
      where: { campaign: { workspaceId }, sentAt: { gte: since } },
      _count: { _all: true },
    }),
  ]);

  const byStatus = Object.fromEntries(statusGroups.map((row) => [row.status, row._count._all]));
  // DELIVERED and READ are states a send passed *through* SENT to reach, so
  // each one counts toward every stage below it.
  const read      = byStatus.READ ?? 0;
  const delivered = (byStatus.DELIVERED ?? 0) + read;
  const sent      = (byStatus.SENT ?? 0) + delivered;
  const failed    = byStatus.FAILED ?? 0;

  return {
    // Echoed so the page can label what it is showing instead of assuming.
    days,
    since,
    timeZone,
    messagesSent,
    totalCampaigns,
    totalContacts,
    newContacts,
    optOuts,
    deliveryRate: percent(delivered, sent),
    optOutRate: percent(optOuts, totalContacts),
    sent,
    delivered,
    read,
    failed,
  };
}

export async function getDeliveryStats(workspaceId, daysParam) {
  const days = clampRangeDays(daysParam);
  // Bucketed by the workspace's calendar day, folding the window's recipients
  // in chunks rather than holding them all at once (CF-048).
  const timeZone = await workspaceTimeZone(workspaceId);
  const { keys, since: windowStart } = zonedDayWindow(days, timeZone);

  const buckets = new Map();
  const daysList = keys.map((key) => {
    const entry = { date: DAY_NAMES[weekdayOfKey(key)], iso: key, sent: 0, delivered: 0, rate: 0 };
    buckets.set(key, entry);
    return entry;
  });

  await forEachChunk(prisma.campaignRecipient, {
    where: {
      campaign: { workspaceId },
      OR: [
        { sentAt: { gte: windowStart } },
        { deliveredAt: { gte: windowStart } },
      ],
    },
    select: { status: true, sentAt: true, deliveredAt: true },
  }, (recipients) => {
    for (const r of recipients) {
      if (r.sentAt && SENT_STATUSES.includes(r.status)) {
        const bucket = buckets.get(zonedDayKey(r.sentAt, timeZone));
        if (bucket) bucket.sent += 1;
      }
      if (r.deliveredAt) {
        const bucket = buckets.get(zonedDayKey(r.deliveredAt, timeZone));
        if (bucket) bucket.delivered += 1;
      }
    }
  });
  for (const d of daysList) d.rate = percent(Math.min(d.delivered, d.sent), d.sent);
  return daysList;
}

export async function getCampaignStats(workspaceId, daysParam) {
  const days = clampRangeDays(daysParam);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return prisma.campaign.findMany({
    where: { workspaceId, createdAt: { gte: since } },
    select: { id: true, name: true, sent: true, delivered: true, read: true, failed: true, totalContacts: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 8,
  });
}

export async function getAgentStats(workspaceId, daysParam) {
  const days = clampRangeDays(daysParam);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const members = await prisma.workspaceMember.findMany({
    where: { workspaceId },
    include: { user: { select: { id: true, name: true } } },
  });

  // One row per (member, conversation) they replied in: the number of rows is
  // the chats they handled, the counts summed are the messages they sent. A
  // member who sends 40 messages in one thread has handled one chat.
  const msgGroups = await prisma.message.groupBy({
    by: ['senderUserId', 'conversationId'],
    where: {
      conversation: { workspaceId },
      direction: 'OUTBOUND',
      sentAt: { gte: since },
      senderUserId: { in: members.map((m) => m.userId) },
    },
    _count: { _all: true },
  });

  const chats = new Map();
  const sent = new Map();
  for (const g of msgGroups) {
    chats.set(g.senderUserId, (chats.get(g.senderUserId) || 0) + 1);
    sent.set(g.senderUserId, (sent.get(g.senderUserId) || 0) + g._count._all);
  }

  return members.map((m) => ({
    agentId: m.userId,
    name: m.user.name,
    chatsHandled: chats.get(m.userId) || 0,
    messagesSent: sent.get(m.userId) || 0,
  }));
}

// ─── Chat analysis ───────────────────────────────────────────────────────────
// Aggregates messages, conversations, campaigns, contacts and top agents for a
// workspace over the last N days (7 / 30 / 90). Everything uses normal Prisma
// queries scoped to workspaceId; the per-day message volume and the campaign
// latency averages use raw queries because Prisma has no portable DATE()
// grouping or interval-average helper.
export async function getChatAnalytics(workspaceId, daysParam = 30) {
  const days = clampDays(daysParam);
  const timeZone = await workspaceTimeZone(workspaceId);
  const { keys: dayKeys, since: startDate, today } = zonedDayWindow(days, timeZone);

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
    latencyRows,           // average delivery + read latency
    contactsTotal,
    contactsOptedOut,
    topAgentGroups,        // outbound grouped by senderUserId
    dailyRows,             // raw per-day volume
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
    // Averaged in SQL. This used to load every recipient the workspace ever
    // had (it is not windowed) to average two subtractions in JS (CF-048).
    prisma.$queryRaw`
      SELECT
        AVG(EXTRACT(EPOCH FROM (r."deliveredAt" - r."sentAt")) * 1000)
          FILTER (WHERE r."deliveredAt" >= r."sentAt") AS "deliveryMs",
        AVG(EXTRACT(EPOCH FROM (r."readAt" - r."sentAt")) * 1000)
          FILTER (WHERE r."readAt" >= r."sentAt") AS "readMs"
      FROM "CampaignRecipient" r
      INNER JOIN "Campaign" c ON c."id" = r."campaignId"
      WHERE c."workspaceId" = ${workspaceId}
        AND r."sentAt" IS NOT NULL
    `,
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
    // Grouped by position: each ${timeZone} is its own bind parameter, so the
    // SELECT and GROUP BY expressions would not compare equal to Postgres.
    prisma.$queryRaw`
      SELECT
        DATE(m."sentAt" AT TIME ZONE 'UTC' AT TIME ZONE ${timeZone})::text AS date,
        COUNT(*) FILTER (WHERE m."direction" = 'OUTBOUND')::int AS sent,
        COUNT(*) FILTER (WHERE m."direction" = 'INBOUND')::int AS received
      FROM "Message" m
      INNER JOIN "Conversation" c ON c."id" = m."conversationId"
      WHERE c."workspaceId" = ${workspaceId}
        AND m."sentAt" >= ${startDate}
      GROUP BY 1
      ORDER BY 1 ASC
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
  const dailyVolume = dayKeys.map((iso) => dailyByDate.get(iso) ?? { date: iso, sent: 0, received: 0 });

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
    timeZone,
    range: { from: dayKeys[0], to: today },
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
      deliveryLatencyMs: Math.round(Number(latencyRows?.[0]?.deliveryMs ?? 0)),
      readLatencyMs: Math.round(Number(latencyRows?.[0]?.readMs ?? 0)),
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

export async function getPaidMessagesInsights(workspaceId, daysParam = 7) {
  const days = clampDays(daysParam);
  const timeZone = await workspaceTimeZone(workspaceId);
  const { keys, since: startDate } = zonedDayWindow(days, timeZone);

  // Each recipient used to carry its whole Campaign row and template, so a
  // 100k-recipient campaign repeated the campaign 100k times. The category is
  // now looked up once per campaign, and recipients are folded in chunks
  // (CF-048).
  const campaigns = await prisma.campaign.findMany({
    where: { workspaceId, recipients: { some: { sentAt: { gte: startDate } } } },
    select: { id: true, template: { select: { category: true } } },
  });
  const categoryOf = new Map(campaigns.map((c) => [c.id, c.template?.category]));

  const totals = {
    totalPaidMessages: 0,
    utility: 0,
    marketing: 0,
    marketingLite: 0, // Mock category, kept for UI compatibility
    authMessages: 0,
  };

  const buckets = new Map();
  const chartData = keys.map((key) => {
    // 'MMM DD' like 'Jun 19' to match the UI. The key is a calendar date, so
    // format it as one (UTC) rather than re-zoning it.
    const dateStr = new Date(`${key}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    const entry = { date: dateStr, val: 0 };
    buckets.set(key, entry);
    return entry;
  });

  await forEachChunk(prisma.campaignRecipient, {
    where: {
      campaign: { workspaceId },
      sentAt: { gte: startDate },
      status: { in: SENT_STATUSES },
    },
    select: { sentAt: true, campaignId: true },
  }, (recipients) => {
    totals.totalPaidMessages += recipients.length;
    for (const r of recipients) {
      if (!r.sentAt) continue;
      const cat = categoryOf.get(r.campaignId);
      if (cat === 'UTILITY') totals.utility++;
      else if (cat === 'MARKETING') totals.marketing++;
      else if (cat === 'AUTHENTICATION') totals.authMessages++;

      const key = zonedDayKey(r.sentAt, timeZone);
      if (buckets.has(key)) {
        buckets.get(key).val++;
      }
    }
  });

  return { totals, chartData };
}


// ─── Audience analytics ──────────────────────────────────────────────────────
//
// Who the contacts are, how the list is growing, and who is actually engaging —
// the customer-facing counterpart to getAgentStats, which measures staff.
//
// One deliberate omission: there is no revenue or lifetime-value figure here.
// Nothing in this database records what a contact spent — orders live in the
// customer's store, not in Spandan — so a "lifetime value" column would be a
// number invented to fill a column. Engagement is measured instead, from data
// that exists, and the page says plainly what would be needed for revenue.

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Monday 00:00 of the week containing `date`, in UTC. Cohorts have to land on a
// stable boundary or two contacts created hours apart end up in different weeks
// depending on when the report is run.
function weekStart(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dow = (d.getUTCDay() + 6) % 7;           // Monday = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return d;
}

const weekLabel = (d) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });

export async function getAudienceAnalytics(workspaceId, weeksParam = 12) {
  const weeks = Math.min(26, Math.max(4, Number.parseInt(weeksParam, 10) || 12));
  const now = new Date();
  const firstWeek = weekStart(new Date(now.getTime() - (weeks - 1) * WEEK_MS));

  const [total, optedOut, contacts] = await Promise.all([
    prisma.contact.count({ where: { workspaceId } }),
    prisma.contact.count({ where: { workspaceId, optedOut: true } }),
    // Only what the maths needs. A workspace can hold hundreds of thousands of
    // contacts, so this selects two columns rather than whole rows, in chunks.
    findManyChunked(prisma.contact, {
      where: { workspaceId, createdAt: { gte: firstWeek } },
      select: { id: true, createdAt: true },
    }),
  ]);

  // ── growth: contacts added per week ──
  const buckets = [];
  for (let i = 0; i < weeks; i += 1) {
    const start = new Date(firstWeek.getTime() + i * WEEK_MS);
    buckets.push({ start, label: weekLabel(start), added: 0 });
  }
  const bucketIndex = (date) => Math.floor((weekStart(date).getTime() - firstWeek.getTime()) / WEEK_MS);

  for (const c of contacts) {
    const i = bucketIndex(c.createdAt);
    if (i >= 0 && i < buckets.length) buckets[i].added += 1;
  }

  // ── retention cohorts ──
  //
  // Rows are the week a contact was added; columns are weeks since. A cell is
  // the share of that cohort that sent at least one inbound message in that
  // week. W0 is not forced to 100%: a contact imported from a CSV who never
  // writes back was never retained in the first place, and pretending otherwise
  // is what makes cohort tables lie.
  //
  // Every inbound message in the window, with the contact it came from, is
  // what "active" means here: the customer wrote back. Folded in chunks, so
  // memory follows the number of active contacts, not messages (CF-048).
  const activeByContactWeek = new Map();   // contactId -> Set(weekIndex)
  await forEachChunk(prisma.message, {
    where: {
      direction: 'INBOUND',
      sentAt: { gte: firstWeek },
      conversation: { workspaceId },
    },
    select: { sentAt: true, conversation: { select: { contactId: true } } },
  }, (activity) => {
    for (const m of activity) {
      const contactId = m.conversation?.contactId;
      if (!contactId) continue;
      const i = bucketIndex(m.sentAt);
      if (i < 0 || i >= buckets.length) continue;
      if (!activeByContactWeek.has(contactId)) activeByContactWeek.set(contactId, new Set());
      activeByContactWeek.get(contactId).add(i);
    }
  });

  const cohortWeeks = Math.min(6, weeks);
  const cohorts = [];
  for (let c = weeks - cohortWeeks; c < weeks; c += 1) {
    if (c < 0) continue;
    const members = contacts.filter((x) => bucketIndex(x.createdAt) === c);
    const cells = [];
    for (let offset = 0; offset < cohortWeeks; offset += 1) {
      const week = c + offset;
      if (week >= weeks) { cells.push(null); continue; }   // hasn't happened yet
      if (members.length === 0) { cells.push(0); continue; }
      const retained = members.filter((m) => activeByContactWeek.get(m.id)?.has(week)).length;
      cells.push(Math.round((retained / members.length) * 100));
    }
    cohorts.push({ label: buckets[c].label, size: members.length, cells });
  }

  // ── engagement leaderboard ──
  //
  // Ranked by conversations and campaigns, both of which are counted rather than
  // fetched, so this stays one query regardless of how much history exists.
  const top = await prisma.contact.findMany({
    where: { workspaceId, optedOut: false },
    select: {
      id: true, name: true, phoneNumber: true, tags: true, createdAt: true,
      _count: { select: { conversations: true, campaignRecipients: true, campaignAiSessions: true } },
    },
    orderBy: [{ campaignRecipients: { _count: 'desc' } }, { createdAt: 'asc' }],
    take: 40,
  });

  const scored = top
    .map((c) => ({
      id: c.id,
      name: c.name,
      phoneNumber: c.phoneNumber,
      tags: c.tags,
      since: c.createdAt,
      conversations: c._count.conversations,
      campaigns: c._count.campaignRecipients,
      aiChats: c._count.campaignAiSessions,
      // Weighted so a customer who replies outranks one who was merely posted
      // to: a conversation is a two-way exchange, a campaign send is not.
      score: c._count.conversations * 3 + c._count.campaignAiSessions * 2 + c._count.campaignRecipients,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  // ── headline numbers ──
  const windowStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const priorStart = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

  const [addedThisMonth, activeLast30, activePrior30] = await Promise.all([
    prisma.contact.count({ where: { workspaceId, createdAt: { gte: windowStart } } }),
    prisma.conversation.count({ where: { workspaceId, lastMessageAt: { gte: windowStart } } }),
    prisma.conversation.count({ where: { workspaceId, lastMessageAt: { gte: priorStart, lt: windowStart } } }),
  ]);

  return {
    weeks,
    total,
    optedIn: total - optedOut,
    optInRate: percent(total - optedOut, total),
    addedThisMonth,
    activeLast30,
    // Retention as a ratio of two consecutive 30-day windows. Null rather than
    // 0 when there is no prior window to compare against, so the page can say
    // "not enough history" instead of showing a confident zero.
    retention30: activePrior30 > 0 ? percent(Math.min(activeLast30, activePrior30), activePrior30) : null,
    growth: buckets.map((b) => ({ label: b.label, added: b.added })),
    cohorts,
    cohortColumns: Array.from({ length: cohortWeeks }, (_, i) => `W${i}`),
    top: scored,
  };
}


// ─── Conversation insights ───────────────────────────────────────────────────
//
// What customers actually talk about, how they sound doing it, and what nobody
// could answer. Everything here is computed from stored messages by rules that
// can be read and argued with — no model call, no per-request cost, and no
// number whose provenance is "the AI said so".
//
// Topics cluster against the workspace's own intent rules when it has any, and
// against a default taxonomy when it does not. That means the clusters a
// business sees are the categories it already told us it cares about, and
// improving the clustering is the same work as improving routing.

const DEFAULT_TOPICS = [
  { name: 'Product availability & size', phrases: ['stock', 'available', 'size', 'sizes', 'colour', 'color', 'variant', 'left'] },
  { name: 'Offers & discount details',   phrases: ['discount', 'offer', 'coupon', 'code', 'price', 'cost', 'deal', 'sale', 'off'] },
  { name: 'Shipping & delivery',         phrases: ['ship', 'shipping', 'deliver', 'delivery', 'track', 'tracking', 'courier', 'arrive', 'dispatch'] },
  { name: 'Returns & exchange',          phrases: ['return', 'exchange', 'refund', 'replace', 'warranty', 'damaged'] },
  { name: 'Payment & checkout',          phrases: ['pay', 'payment', 'upi', 'card', 'cod', 'checkout', 'invoice', 'order'] },
];

// Sentiment by lexicon. Coarse and honest: it reads words, not meaning, and the
// page says so. The alternative — an LLM call per message — would put a bill and
// a latency spike behind a chart nobody asked to be exact.
const POSITIVE_WORDS = [
  'thanks', 'thank', 'great', 'good', 'perfect', 'love', 'awesome', 'excellent', 'nice',
  'happy', 'super', 'best', 'wonderful', 'helpful', 'fast', 'quick', 'received', 'works',
];
const NEGATIVE_WORDS = [
  'not', 'no', 'bad', 'worst', 'terrible', 'awful', 'poor', 'slow', 'late', 'delay', 'delayed',
  'wrong', 'broken', 'damaged', 'missing', 'never', 'cancel', 'refund', 'complaint', 'angry',
  'disappointed', 'useless', 'fake', 'cheat', 'issue', 'problem', 'error', 'failed',
];

const wordsOf = (text) => String(text || '')
  .toLowerCase()
  .replace(/[^\p{L}\p{N}\s]/gu, ' ')
  .split(/\s+/)
  .filter(Boolean);

function classifySentiment(text) {
  const words = new Set(wordsOf(text));
  let pos = 0;
  let neg = 0;
  for (const w of POSITIVE_WORDS) if (words.has(w)) pos += 1;
  for (const w of NEGATIVE_WORDS) if (words.has(w)) neg += 1;
  if (pos === 0 && neg === 0) return 'neutral';
  if (neg > pos) return 'negative';
  if (pos > neg) return 'positive';
  return 'neutral';
}

export async function getConversationInsights(workspaceId, daysParam = 30) {
  // clampRangeDays, not clampDays: this feeds the Analytics page's topic panel,
  // whose control offers 1/7/14/30/90. Under the 7/30/90 clamp a "24 hours" or
  // "14 days" selection silently fell back to 30 and the panel showed a month
  // of topics under a label that said otherwise.
  const days = clampRangeDays(daysParam);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [intentRules, messages, fellThrough] = await Promise.all([
    prisma.intentRule.findMany({
      where: { workspaceId },
      select: { id: true, name: true, icon: true, phrases: true },
      orderBy: { sortOrder: 'asc' },
    }),
    // Inbound only: what the customer said is the subject here. Outbound is the
    // business talking to itself.
    prisma.message.findMany({
      where: { direction: 'INBOUND', sentAt: { gte: since }, conversation: { workspaceId } },
      select: { body: true, conversationId: true, sentAt: true },
      take: 20000,
    }),
    // Every message intent matching could not place. These are the clearest
    // knowledge gaps the product has: a customer asked, and nothing knew.
    prisma.intentMatchEvent.findMany({
      where: { workspaceId, outcome: 'FELL_THROUGH', createdAt: { gte: since } },
      select: { sample: true },
      take: 5000,
    }),
  ]);

  const taxonomy = intentRules.length
    ? intentRules.map(r => ({
        name: r.name,
        icon: r.icon,
        phrases: (Array.isArray(r.phrases) ? r.phrases : []).flatMap(ph => wordsOf(ph)),
      })).filter(t => t.phrases.length)
    : DEFAULT_TOPICS;

  // ── topics ──
  const counts = new Map(taxonomy.map(t => [t.name, 0]));
  let other = 0;
  for (const m of messages) {
    const words = new Set(wordsOf(m.body));
    let bestName = null;
    let bestHits = 0;
    for (const topic of taxonomy) {
      let hits = 0;
      for (const w of topic.phrases) if (words.has(w)) hits += 1;
      if (hits > bestHits) { bestHits = hits; bestName = topic.name; }
    }
    if (bestName) counts.set(bestName, counts.get(bestName) + 1);
    else other += 1;
  }

  const topics = [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .filter(t => t.count > 0)
    .sort((a, b) => b.count - a.count);
  if (other > 0) topics.push({ name: 'Other', count: other });

  const topicTotal = topics.reduce((sum, t) => sum + t.count, 0);
  const topTopicCount = topics.length ? topics[0].count : 0;
  const topicRows = topics.map(t => ({
    ...t,
    share: percent(t.count, topicTotal),
    // Bar width is relative to the largest topic, not to the total: with six
    // topics the biggest would otherwise be a third of the track and the rest
    // invisible slivers.
    width: topTopicCount > 0 ? Math.round((t.count / topTopicCount) * 100) : 0,
  }));

  // ── sentiment ──
  const sentimentCounts = { positive: 0, neutral: 0, negative: 0 };
  const negativeByTopic = new Map();
  for (const m of messages) {
    const label = classifySentiment(m.body);
    sentimentCounts[label] += 1;
    if (label !== 'negative') continue;
    const words = new Set(wordsOf(m.body));
    for (const topic of taxonomy) {
      if (topic.phrases.some(w => words.has(w))) {
        negativeByTopic.set(topic.name, (negativeByTopic.get(topic.name) || 0) + 1);
        break;
      }
    }
  }
  const sentimentTotal = messages.length;
  const worstTopic = [...negativeByTopic.entries()].sort((a, b) => b[1] - a[1])[0] || null;

  // ── knowledge gaps ──
  //
  // Two sources, both real. Messages intent matching could not place, and
  // customer questions that never got an answer in that conversation.
  const gapCounts = new Map();
  const addGap = (text) => {
    const clean = String(text || '').trim();
    if (clean.length < 6 || clean.length > 160) return;
    const key = clean.toLowerCase();
    const entry = gapCounts.get(key) || { question: clean, count: 0 };
    entry.count += 1;
    gapCounts.set(key, entry);
  };
  for (const e of fellThrough) addGap(e.sample);

  // Unanswered questions: an inbound message ending in a question mark in a
  // conversation with no outbound message after it.
  const questionMessages = messages.filter(m => String(m.body || '').includes('?'));
  if (questionMessages.length) {
    const conversationIds = [...new Set(questionMessages.map(m => m.conversationId))].slice(0, 500);
    // Only the latest reply per conversation matters, so ask for exactly that:
    // at most one row per conversation instead of every outbound message.
    const replies = await prisma.message.groupBy({
      by: ['conversationId'],
      where: { conversationId: { in: conversationIds }, direction: 'OUTBOUND', sentAt: { gte: since } },
      _max: { sentAt: true },
    });
    const lastReplyAt = new Map(replies.map((r) => [r.conversationId, r._max.sentAt]));
    for (const q of questionMessages) {
      const answeredAt = lastReplyAt.get(q.conversationId);
      if (!answeredAt || answeredAt < q.sentAt) addGap(q.body);
    }
  }

  const gaps = [...gapCounts.values()].sort((a, b) => b.count - a.count).slice(0, 8);

  return {
    days,
    // Keyword matching, not a model: topics are word-list hits and sentiment
    // counts positive/negative words. Reported so the UI can say so.
    method: 'keyword-heuristic',
    analysed: messages.length,
    clusteredBy: intentRules.length ? 'intents' : 'default',
    topics: topicRows,
    sentiment: {
      total: sentimentTotal,
      positive: { count: sentimentCounts.positive, pct: percent(sentimentCounts.positive, sentimentTotal) },
      neutral:  { count: sentimentCounts.neutral,  pct: percent(sentimentCounts.neutral,  sentimentTotal) },
      negative: { count: sentimentCounts.negative, pct: percent(sentimentCounts.negative, sentimentTotal) },
      // The one line worth reading out of the chart, when there is one.
      insight: worstTopic
        ? `Negative messages cluster in ${worstTopic[0].toLowerCase()} — ${worstTopic[1]} of ${sentimentCounts.negative}. Adding that to the agent's knowledge is the highest-leverage fix.`
        : null,
    },
    gaps,
  };
}


// ─── Campaign performance ────────────────────────────────────────────────────
//
// The funnel, the AI/human split and the campaign leaderboard behind the
// Analytics page.
//
// The funnel stops at "started a conversation" rather than running on to
// "clicked" and "converted". Nothing in this database records a click or a
// purchase — that needs the customer's store or payment provider connected, and
// until it is, those two bars would be decoration. The page says so where the
// funnel ends, rather than showing a number nobody can trace.

export async function getPerformance(workspaceId, daysParam = 14) {
  const days = clampRangeDays(daysParam);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // Every funnel stage is measured on one population: campaign recipients the
  // network accepted in the window. Mixing in organic inbox traffic let
  // "Replied" exceed "Delivered".
  const [lastInbound, aiSessions, conversations, campaigns] = await Promise.all([
    // Each conversation's latest inbound message in the window; a recipient
    // replied if their contact wrote in at or after the send.
    prisma.message.groupBy({
      by: ['conversationId'],
      where: { direction: 'INBOUND', sentAt: { gte: since }, conversation: { workspaceId } },
      _max: { sentAt: true },
    }),
    // A recipient who tapped the campaign's CTA and opened a chat. This is the
    // deepest engagement step the product can actually observe.
    prisma.campaignAiSession.count({
      where: { workspaceId, campaignRecipient: { sentAt: { gte: since }, status: { in: SENT_STATUSES } } },
    }),
    // Enough of each conversation to say who answered it. Outbound messages
    // carry senderUserId; a null sender is the bot or an automation.
    prisma.conversation.findMany({
      where: { workspaceId, lastMessageAt: { gte: since } },
      select: {
        id: true,
        status: true,
        messages: {
          where: { direction: 'OUTBOUND' },
          select: { senderUserId: true },
          take: 50,
        },
      },
      take: 5000,
    }),
    prisma.campaign.findMany({
      where: { workspaceId, createdAt: { gte: since } },
      select: {
        id: true, name: true, status: true, sent: true, delivered: true, read: true, failed: true,
        createdAt: true,
        _count: { select: { aiSessions: true } },
      },
      orderBy: { sent: 'desc' },
      take: 8,
    }),
  ]);

  const inboundConversationIds = lastInbound.map((row) => row.conversationId);
  const conversationContacts = inboundConversationIds.length
    ? await prisma.conversation.findMany({
        where: { id: { in: inboundConversationIds } },
        select: { id: true, contactId: true },
      })
    : [];
  const contactOf = new Map(conversationContacts.map((c) => [c.id, c.contactId]));
  const lastInboundByContact = new Map();
  for (const row of lastInbound) {
    const contactId = contactOf.get(row.conversationId);
    const at = row._max.sentAt;
    if (!contactId || !at) continue;
    const prev = lastInboundByContact.get(contactId);
    if (!prev || at > prev) lastInboundByContact.set(contactId, at);
  }

  // The recipients themselves are folded in chunks: a big campaign in the
  // window no longer means every recipient row in memory at once (CF-048).
  let sent = 0;
  let delivered = 0;
  let readCount = 0;
  let replied = 0;
  await forEachChunk(prisma.campaignRecipient, {
    where: { campaign: { workspaceId }, sentAt: { gte: since }, status: { in: SENT_STATUSES } },
    select: { contactId: true, status: true, sentAt: true, readAt: true },
  }, (recipients) => {
    for (const r of recipients) {
      sent += 1;
      if (r.status === 'DELIVERED' || r.status === 'READ') delivered += 1;
      if (r.status === 'READ' || r.readAt) readCount += 1;
      const at = lastInboundByContact.get(r.contactId);
      if (at && r.sentAt && at >= r.sentAt) replied += 1;
    }
  });

  const stage = (label, value, note) => ({
    label,
    value,
    note,
    pct: percent(value, sent),
  });

  const funnel = [
    stage('Sent', sent, 'Recipients the network accepted'),
    stage('Delivered', delivered, 'Confirmed on the handset'),
    stage('Read', readCount, 'Blue ticks returned by Meta'),
    stage('Replied', replied, 'Recipients who wrote back after the send'),
    stage('Started an AI chat', aiSessions, 'Tapped the CTA and asked something'),
  ];

  // ── who answered ──
  //
  // "By automation" needs an automated reply and no human one; a conversation
  // closed with no reply at all is counted as such, not credited to the AI.
  let byAi = 0;
  let byHuman = 0;
  let noReply = 0;
  let open = 0;
  for (const c of conversations) {
    if (c.status === 'OPEN') { open += 1; continue; }
    if (c.messages.some((m) => m.senderUserId != null)) byHuman += 1;
    else if (c.messages.length > 0) byAi += 1;
    else noReply += 1;
  }
  const resolvedTotal = conversations.length;

  const leaderboard = campaigns.map((c) => ({
    id: c.id,
    name: c.name,
    status: c.status,
    sent: c.sent ?? 0,
    delivered: c.delivered ?? 0,
    read: c.read ?? 0,
    readRate: percent(c.read ?? 0, c.sent ?? 0),
    deliveryRate: percent(c.delivered ?? 0, c.sent ?? 0),
    conversations: c._count.aiSessions,
    // Share of recipients who went on to ask something. The closest honest
    // stand-in for a conversion rate this product can compute on its own.
    engagementRate: percent(c._count.aiSessions, c.sent ?? 0),
  }));

  return {
    days,
    funnel,
    resolution: {
      total: resolvedTotal,
      byAi:    { count: byAi,    pct: percent(byAi, resolvedTotal) },
      byHuman: { count: byHuman, pct: percent(byHuman, resolvedTotal) },
      noReply: { count: noReply, pct: percent(noReply, resolvedTotal) },
      open:    { count: open,    pct: percent(open, resolvedTotal) },
    },
    leaderboard,
    // Stated rather than implied, so nobody reads the funnel as complete.
    revenueAvailable: false,
  };
}
