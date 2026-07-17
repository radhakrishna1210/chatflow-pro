import { Router } from 'express';
import authRoutes from './auth.routes.js';
import whatsappRoutes from './whatsapp.routes.js';
import templatesRoutes from './templates.routes.js';
import campaignsRoutes from './campaigns.routes.js';
import contactsRoutes from './contacts.routes.js';
import conversationsRoutes from './conversations.routes.js';
import analyticsRoutes from './analytics.routes.js';
import automationRoutes from './automation.routes.js';
import settingsRoutes from './settings.routes.js';
import membersRoutes from './members.routes.js';
import apiKeysRoutes from './apikeys.routes.js';
import adminRoutes from './admin.routes.js';
import webhookRoutes from './webhook.routes.js';
import onboardingRoutes from './onboarding.routes.js';
import aiRoutes from './ai.routes.js';
import workflowRoutes from './workflow.routes.js';
import segmentsRoutes from './segments.routes.js';
import whatsappFormsRoutes from './whatsappForms.routes.js';
import walletRoutes from './wallet.routes.js';
import integrationsRoutes, { oauthCallbackRouter } from './integrations.routes.js';
import supportRoutes from './support.routes.js';
import workspacesRoutes from './workspaces.routes.js';
import subscriptionRoutes from './subscription.routes.js';
import aiAgentRoutes from './aiAgent.routes.js';

const router = Router();

router.get('/health', (req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

router.use('/auth', authRoutes);
router.use('/webhook', webhookRoutes);
router.use('/admin', adminRoutes);
router.use('/integrations/oauth', oauthCallbackRouter);

const ws = Router({ mergeParams: true });
ws.use('/whatsapp', whatsappRoutes);
ws.use('/templates', templatesRoutes);
ws.use('/campaigns', campaignsRoutes);
ws.use('/contacts', contactsRoutes);
ws.use('/conversations', conversationsRoutes);
ws.use('/analytics', analyticsRoutes);
ws.use('/automation', automationRoutes);
ws.use('/settings', settingsRoutes);
ws.use('/members', membersRoutes);
ws.use('/api-keys', apiKeysRoutes);
ws.use('/segments', segmentsRoutes);
ws.use('/whatsapp-forms', whatsappFormsRoutes);
ws.use('/workflows', workflowRoutes);
ws.use('/wallet', walletRoutes);
ws.use('/subscription', subscriptionRoutes);
ws.use('/integrations', integrationsRoutes);
ws.use('/support', supportRoutes);
ws.use('/ai-agent', aiAgentRoutes);

router.use('/onboarding', onboardingRoutes);
router.use('/ai', aiRoutes);
router.use('/workspaces', workspacesRoutes); // POST /workspaces (create) — must not shadow the :workspaceId routes below
router.use('/workspaces/:workspaceId', ws);

export default router;
