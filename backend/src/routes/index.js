import { Router } from 'express';
import authRoutes from './auth.routes.js';
import publicRoutes from './public.routes.js';
import whatsappRoutes from './whatsapp.routes.js';
import templatesRoutes from './templates.routes.js';
import campaignsRoutes from './campaigns.routes.js';
import contactsRoutes from './contacts.routes.js';
import clustersRoutes from './clusters.routes.js';
import leadsRoutes from './leads.routes.js';
import dealsRoutes from './deals.routes.js';
import tasksRoutes from './tasks.routes.js';
import activitiesRoutes from './activities.routes.js';
import crmAnalyticsRoutes from './crm-analytics.routes.js';
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
import instagramRoutes from './instagram.routes.js';
import voiceRoutes from './voice.routes.js';
import * as instagramController from '../controllers/instagram.controller.js';
import segmentsRoutes from './segments.routes.js';
import whatsappFormsRoutes from './whatsappForms.routes.js';
import walletRoutes from './wallet.routes.js';
import integrationsRoutes, { oauthCallbackRouter } from './integrations.routes.js';
import supportRoutes from './support.routes.js';
import workspacesRoutes from './workspaces.routes.js';
import subscriptionRoutes from './subscription.routes.js';
import aiAgentRoutes from './aiAgent.routes.js';
import invitationsRoutes, { publicInvitationsRouter } from './invitations.routes.js';
import workspaceSwitchRoutes from './workspaceSwitch.routes.js';
import usersRoutes from './users.routes.js';
import notificationsRoutes from './notifications.routes.js';
import optOutRoutes from './optout.routes.js';
import searchRoutes from './search.routes.js';
import savedViewsRoutes from './savedViews.routes.js';
import pipelineStagesRoutes from './pipelineStages.routes.js';
import forecastRoutes from './forecast.routes.js';
import productsRoutes from './products.routes.js';
import quotesRoutes from './quotes.routes.js';
import crmDataRoutes from './crmData.routes.js';
import customFieldsRoutes from './customFields.routes.js';
import sequencesRoutes from './sequences.routes.js';
import teamsRoutes from './teams.routes.js';
import { MESSAGE_CATEGORY_RATES } from '../lib/messagePricing.js';

const router = Router();

router.get('/health', (req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// Published rate card, unauthenticated: the marketing site quotes campaign
// costs from this, so it quotes the same per-category rates campaigns are
// actually billed at. Nothing here is workspace-specific — a hardcoded price
// in the landing page is how a customer gets quoted a figure the billing code
// will not honour.
router.get('/pricing', (req, res) => res.json({ currency: 'INR', rates: MESSAGE_CATEGORY_RATES }));

router.use('/auth', authRoutes);
router.use('/public', publicRoutes);
router.use('/webhook', webhookRoutes);
// Public, signature-verified webhooks: Instagram DMs/comments and Twilio voice.
router.get('/webhook/instagram', instagramController.verifyWebhook);
router.post('/webhook/instagram', instagramController.receiveWebhook);
router.use('/voice', voiceRoutes);
router.use('/admin', adminRoutes);
router.use('/users', usersRoutes);
// User-scoped, not workspace-scoped: an invitation notification reaches you
// before you belong to the workspace that sent it.
router.use('/notifications', notificationsRoutes);
router.use('/integrations/oauth', oauthCallbackRouter);
router.use('/invitations', publicInvitationsRouter);

const ws = Router({ mergeParams: true });
ws.use('/whatsapp', whatsappRoutes);
ws.use('/templates', templatesRoutes);
ws.use('/campaigns', campaignsRoutes);
ws.use('/contacts', contactsRoutes);
ws.use('/clusters', clustersRoutes);
ws.use('/leads', leadsRoutes);
ws.use('/deals', dealsRoutes);
ws.use('/tasks', tasksRoutes);
ws.use('/activities', activitiesRoutes);
ws.use('/crm-analytics', crmAnalyticsRoutes);
ws.use('/search', searchRoutes);
ws.use('/saved-views', savedViewsRoutes);
ws.use('/pipeline-stages', pipelineStagesRoutes);
ws.use('/forecast', forecastRoutes);
ws.use('/products', productsRoutes);
ws.use('/quotes', quotesRoutes);
ws.use('/crm-data', crmDataRoutes);
ws.use('/custom-fields', customFieldsRoutes);
ws.use('/sequences', sequencesRoutes);
ws.use('/teams', teamsRoutes);
ws.use('/conversations', conversationsRoutes);
ws.use('/analytics', analyticsRoutes);
ws.use('/automation', automationRoutes);
ws.use('/settings', settingsRoutes);
ws.use('/members', membersRoutes);
ws.use('/api-keys', apiKeysRoutes);
ws.use('/segments', segmentsRoutes);
ws.use('/whatsapp-forms', whatsappFormsRoutes);
ws.use('/workflows', workflowRoutes);
ws.use('/instagram', instagramRoutes);
ws.use('/wallet', walletRoutes);
ws.use('/opt-outs', optOutRoutes);
// Friendlier alias for the Settings → Blocked Numbers screen.
ws.use('/blocked-numbers', optOutRoutes);
ws.use('/subscription', subscriptionRoutes);
ws.use('/integrations', integrationsRoutes);
ws.use('/support', supportRoutes);
ws.use('/ai-agent', aiAgentRoutes);
ws.use('/invitations', invitationsRoutes);
ws.use('/switch', workspaceSwitchRoutes);

router.use('/onboarding', onboardingRoutes);
router.use('/ai', aiRoutes);
router.use('/workspaces', workspacesRoutes); // POST /workspaces (create) — must not shadow the :workspaceId routes below
router.use('/workspaces/:workspaceId', ws);

export default router;
