import { prisma } from '../lib/prisma.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// Status of the CRM's ingestion and messaging integrations, built only from
// what the system has actually recorded: the number rows Meta's responses keep
// up to date (status, unreachableSince, webhook subscription, quality), the
// last inbound message (proof the webhook is delivering), recent send failures,
// and the integration rows. Nothing is measured live here, so nothing claims
// to be — the old latency, uptime and "Graph API healthy" figures were
// constants and have been removed.
export async function getIntegrationHealth(workspaceId) {
  const since = new Date(Date.now() - DAY_MS);
  const inWorkspace = { conversation: { workspaceId } };
  const [waNumbers, fbIntegration, sheetsIntegration, lastInbound, lastFailure, failedLast24h, sentLast24h] = await Promise.all([
    prisma.waNumber.findMany({
      where: { workspaceId },
      select: {
        id: true, phoneNumber: true, displayName: true, status: true, quality: true,
        appSubscribed: true, unreachableSince: true, unreachableReason: true, codeVerificationStatus: true,
      },
    }),
    prisma.workspaceIntegration.findFirst({
      where: { workspaceId, provider: 'facebook-lead' },
      select: { status: true, connectedAt: true },
    }),
    // The catalogue's google-sheets entry connects through the `google` OAuth provider.
    prisma.workspaceIntegration.findFirst({
      where: { workspaceId, provider: { in: ['google-sheets', 'google'] } },
      select: { status: true, connectedAt: true },
    }),
    prisma.message.findFirst({
      where: { ...inWorkspace, direction: 'INBOUND' },
      orderBy: { sentAt: 'desc' },
      select: { sentAt: true },
    }),
    prisma.message.findFirst({
      where: { ...inWorkspace, direction: 'OUTBOUND', status: 'FAILED' },
      orderBy: { sentAt: 'desc' },
      select: { sentAt: true, statusAt: true, errorCode: true, errorMessage: true },
    }),
    prisma.message.count({ where: { ...inWorkspace, direction: 'OUTBOUND', status: 'FAILED', sentAt: { gte: since } } }),
    prisma.message.count({ where: { ...inWorkspace, direction: 'OUTBOUND', sentAt: { gte: since } } }),
  ]);

  const numbers = waNumbers.map((n) => {
    const problems = [];
    if (n.unreachableSince) problems.push(`Unreachable since ${n.unreachableSince.toISOString()}${n.unreachableReason ? `: ${n.unreachableReason}` : ''}`);
    if (n.status && n.status !== 'ACTIVE') problems.push(`Number status ${n.status}`);
    if (!n.appSubscribed) problems.push('Webhook not subscribed for this number');
    if (n.codeVerificationStatus === 'EXPIRED') problems.push('Meta verification expired');
    return {
      phoneNumber: n.phoneNumber,
      displayName: n.displayName || null,
      status: n.status,
      quality: n.quality || null,
      webhookSubscribed: n.appSubscribed,
      healthy: problems.length === 0,
      problems,
    };
  });

  const unhealthyNumbers = numbers.filter((n) => !n.healthy).length;
  let waStatus = 'DISCONNECTED';
  if (numbers.length > 0) waStatus = unhealthyNumbers === 0 ? 'HEALTHY' : 'DEGRADED';

  const whatsappHealth = {
    name: 'WhatsApp Cloud API',
    provider: 'whatsapp',
    category: 'Messaging & Outbound',
    status: waStatus,
    statusCode: waStatus === 'DISCONNECTED' ? 'ACTION_REQUIRED' : waStatus === 'HEALTHY' ? 'CONNECTED' : 'ATTENTION',
    details: numbers.length === 0
      ? 'No WhatsApp number connected to this workspace'
      : `${numbers.length} number(s) connected, ${unhealthyNumbers} need attention`,
    numbers,
    lastInboundAt: lastInbound?.sentAt ?? null,
    sendsLast24h: sentLast24h,
    failedSendsLast24h: failedLast24h,
    lastSendFailure: lastFailure
      ? { at: lastFailure.statusAt ?? lastFailure.sentAt, code: lastFailure.errorCode ?? null, message: lastFailure.errorMessage ?? null }
      : null,
  };

  const integrationHealth = (row, base, connectedText, idleText) => {
    const connected = row?.status === 'CONNECTED';
    return {
      ...base,
      status: connected ? 'HEALTHY' : 'NOT_CONFIGURED',
      statusCode: connected ? 'CONNECTED' : 'NOT_CONFIGURED',
      details: connected ? connectedText : idleText,
      connectedAt: row?.connectedAt ?? null,
    };
  };

  const facebookHealth = integrationHealth(
    fbIntegration,
    { name: 'Facebook Lead Ads', provider: 'facebook-lead', category: 'Lead Capture & Ingestion' },
    'Integration connected',
    'No Facebook Lead Ads integration connected',
  );

  const sheetsHealth = integrationHealth(
    sheetsIntegration,
    { name: 'Google Sheets Sync', provider: 'google-sheets', category: 'Pipeline Backup & Export' },
    'Integration connected',
    'No Google Sheets integration connected',
  );

  const integrations = [whatsappHealth, facebookHealth, sheetsHealth];
  const healthyCount = integrations.filter((i) => i.status === 'HEALTHY').length;

  // WhatsApp is the one integration the CRM cannot work without; optional ones
  // that are simply not set up do not count against the workspace.
  let overallStatus = 'ALL_SYSTEMS_OPERATIONAL';
  if (waStatus !== 'HEALTHY') overallStatus = 'NEEDS_ATTENTION';

  return {
    overallStatus,
    healthyCount,
    totalIntegrations: integrations.length,
    lastCheckedAt: new Date().toISOString(),
    integrations,
  };
}
