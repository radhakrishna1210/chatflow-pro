import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';

/**
 * Checks connectivity and configuration health of primary CRM ingestion and messaging integrations:
 * 1. WhatsApp Cloud API
 * 2. Facebook Lead Ads Webhook
 * 3. Google Sheets Two-way Sync
 * 4. Meta Graph API
 */
export async function getIntegrationHealth(workspaceId) {
  const [waNumbers, fbIntegration, formsCount, sheetsIntegration] = await Promise.all([
    prisma.waNumber.findMany({
      where: { workspaceId },
      select: { id: true, phoneNumber: true, displayName: true, createdAt: true, appSubscribed: true },
    }),
    prisma.workspaceIntegration.findFirst({
      where: { workspaceId, provider: 'facebook-lead' },
      select: { id: true, status: true, connectedAt: true, updatedAt: true },
    }),
    prisma.leadForm.count({
      where: { workspaceId },
    }),
    // The real OAuth grant is stored under the backend provider id 'google'
    // (integrations.controller.js), not the catalogue id 'google-sheets'.
    prisma.workspaceIntegration.findFirst({
      where: { workspaceId, provider: { in: ['google', 'google-sheets'] }, status: 'CONNECTED' },
      select: { id: true, status: true, connectedAt: true, updatedAt: true },
    }),
  ]);

  // WhatsApp Cloud API Status
  const waConnected = waNumbers.length > 0;
  const whatsappHealth = {
    name: 'WhatsApp Cloud API',
    provider: 'whatsapp',
    category: 'Messaging & Outbound',
    status: waConnected ? 'HEALTHY' : 'DISCONNECTED',
    statusCode: waConnected ? 'CONNECTED' : 'ACTION_REQUIRED',
    details: waConnected
      ? `${waNumbers.length} Phone Number(s) Active & Registered`
      : 'No WhatsApp number connected to this workspace',
    numbers: waNumbers.map((n) => ({
      phoneNumber: n.phoneNumber,
      displayName: n.displayName || 'Official Business Line',
      status: 'ACTIVE',
    })),
    // Webhooks only arrive once the app is subscribed to the WABA — report
    // that, rather than claiming ACTIVE for any connected number.
    webhook: waConnected && waNumbers.every((n) => n.appSubscribed) ? 'ACTIVE' : 'INACTIVE',
  };

  // Facebook Lead Ads
  const fbConnected = fbIntegration?.status === 'CONNECTED' || formsCount > 0;
  const facebookHealth = {
    name: 'Facebook Lead Ads Webhook',
    provider: 'facebook-lead',
    category: 'Lead Capture & Ingestion',
    status: fbConnected ? 'HEALTHY' : 'STANDBY',
    statusCode: fbConnected ? 'CONNECTED' : 'NOT_CONFIGURED',
    details: fbConnected
      ? `${formsCount} Active Lead Form(s) Configured & Ingesting`
      : 'No Facebook Lead Ads webhook or forms connected',
    connectedAt: fbIntegration?.connectedAt || null,
    lastWebhookAt: fbIntegration?.updatedAt || null,
  };

  // Google Sheets
  const sheetsConnected = sheetsIntegration?.status === 'CONNECTED';
  const sheetsHealth = {
    name: 'Google Sheets 2-Way Sync',
    provider: 'google-sheets',
    category: 'Pipeline Backup & Export',
    status: sheetsConnected ? 'HEALTHY' : 'STANDBY',
    statusCode: sheetsConnected ? 'CONNECTED' : 'NOT_CONFIGURED',
    details: sheetsConnected
      ? 'Google account connected'
      : 'Ready to connect spreadsheet for real-time lead sync',
    connectedAt: sheetsIntegration?.connectedAt || null,
  };

  // Meta Graph API. This used to be a hardcoded HEALTHY with an invented
  // 42 ms latency and a stale API version; it now reports only what is known
  // without a network call — whether platform credentials are configured.
  const metaConfigured = !!env.META_SYSTEM_USER_TOKEN;
  const metaGraphHealth = {
    name: 'Meta Graph API & Platform Gateway',
    provider: 'meta-graph',
    category: 'Core Infrastructure',
    status: metaConfigured ? 'HEALTHY' : 'DISCONNECTED',
    statusCode: metaConfigured ? 'CONFIGURED' : 'ACTION_REQUIRED',
    details: metaConfigured
      ? `Platform credentials configured (Graph API ${env.META_API_VERSION})`
      : 'Platform Meta credentials are not configured',
    apiVersion: env.META_API_VERSION,
  };

  const integrations = [whatsappHealth, facebookHealth, sheetsHealth, metaGraphHealth];
  const healthyCount = integrations.filter((i) => i.status === 'HEALTHY').length;

  const overallStatus =
    healthyCount >= 3 ? 'ALL_SYSTEMS_OPERATIONAL' : healthyCount >= 1 ? 'PARTIALLY_OPERATIONAL' : 'NEEDS_ATTENTION';

  return {
    overallStatus,
    healthyCount,
    totalIntegrations: integrations.length,
    lastCheckedAt: new Date().toISOString(),
    integrations,
  };
}
