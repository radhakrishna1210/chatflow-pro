| Method | Path | Router file:line | Middleware chain | Handler |
|---|---|---|---|---|
| POST | `/api/v1/admin/meta/test-calls` | backend/src/routes/admin.routes.js:45 | authenticate / requireSuperAdmin | adminController.metaTestCalls |
| POST | `/api/v1/admin/numbers/add` | backend/src/routes/admin.routes.js:13 | authenticate / requireSuperAdmin | adminController.addNumber |
| POST | `/api/v1/admin/numbers/assign` | backend/src/routes/admin.routes.js:14 | authenticate / requireSuperAdmin | adminController.assignToWorkspace |
| GET | `/api/v1/admin/numbers/pool` | backend/src/routes/admin.routes.js:12 | authenticate / requireSuperAdmin | adminController.getPool |
| PATCH | `/api/v1/admin/numbers/pool/:id/ban` | backend/src/routes/admin.routes.js:17 | authenticate / requireSuperAdmin | adminController.banPoolEntry |
| PATCH | `/api/v1/admin/numbers/pool/:id/reset` | backend/src/routes/admin.routes.js:16 | authenticate / requireSuperAdmin | adminController.resetPoolEntry |
| PATCH | `/api/v1/admin/numbers/pool/:id/unban` | backend/src/routes/admin.routes.js:18 | authenticate / requireSuperAdmin | adminController.unbanPoolEntry |
| POST | `/api/v1/admin/numbers/request-otp` | backend/src/routes/admin.routes.js:32 | authenticate / requireSuperAdmin | adminController.requestOtp |
| POST | `/api/v1/admin/numbers/reset-all` | backend/src/routes/admin.routes.js:15 | authenticate / requireSuperAdmin | adminController.resetAllAssignments |
| POST | `/api/v1/admin/numbers/sync-from-waba` | backend/src/routes/admin.routes.js:36 | authenticate / requireSuperAdmin | adminController.syncPoolFromWaba |
| POST | `/api/v1/admin/numbers/verify-otp` | backend/src/routes/admin.routes.js:33 | authenticate / requireSuperAdmin | adminController.verifyOtp |
| GET | `/api/v1/admin/platform/audit` | backend/src/routes/admin.routes.js:74 | authenticate / requireSuperAdmin | adminController.auditLog |
| GET | `/api/v1/admin/platform/audit/actions` | backend/src/routes/admin.routes.js:75 | authenticate / requireSuperAdmin | adminController.auditActions |
| GET | `/api/v1/admin/platform/audit/summary` | backend/src/routes/admin.routes.js:76 | authenticate / requireSuperAdmin | adminController.auditSummary |
| GET | `/api/v1/admin/platform/campaigns` | backend/src/routes/admin.routes.js:56 | authenticate / requireSuperAdmin | adminController.listAllCampaigns |
| GET | `/api/v1/admin/platform/credential-check` | backend/src/routes/admin.routes.js:24 | authenticate / requireSuperAdmin | adminController.checkSystemCredentials |
| GET | `/api/v1/admin/platform/payments` | backend/src/routes/admin.routes.js:65 | authenticate / requireSuperAdmin | adminController.paymentsAnalysis |
| GET | `/api/v1/admin/platform/plans` | backend/src/routes/admin.routes.js:78 | authenticate / requireSuperAdmin | adminController.listPlans |
| POST | `/api/v1/admin/platform/plans` | backend/src/routes/admin.routes.js:79 | authenticate / requireSuperAdmin | adminController.createPlan |
| DELETE | `/api/v1/admin/platform/plans/:id` | backend/src/routes/admin.routes.js:81 | authenticate / requireSuperAdmin | adminController.deletePlan |
| PATCH | `/api/v1/admin/platform/plans/:id` | backend/src/routes/admin.routes.js:80 | authenticate / requireSuperAdmin | adminController.updatePlan |
| GET | `/api/v1/admin/platform/revenue` | backend/src/routes/admin.routes.js:57 | authenticate / requireSuperAdmin | adminController.revenueOverview |
| GET | `/api/v1/admin/platform/settings` | backend/src/routes/admin.routes.js:22 | authenticate / requireSuperAdmin | adminController.getSystemSettings |
| POST | `/api/v1/admin/platform/settings` | backend/src/routes/admin.routes.js:23 | authenticate / requireSuperAdmin | adminController.updateSystemSettings |
| GET | `/api/v1/admin/platform/stats` | backend/src/routes/admin.routes.js:48 | authenticate / requireSuperAdmin | adminController.platformStats |
| GET | `/api/v1/admin/platform/tickets` | backend/src/routes/admin.routes.js:51 | authenticate / requireSuperAdmin | adminController.listTickets |
| PATCH | `/api/v1/admin/platform/tickets/:id` | backend/src/routes/admin.routes.js:52 | authenticate / requireSuperAdmin | adminController.updateTicket |
| GET | `/api/v1/admin/platform/transactions` | backend/src/routes/admin.routes.js:55 | authenticate / requireSuperAdmin | adminController.transactionAnalysis |
| GET | `/api/v1/admin/platform/users` | backend/src/routes/admin.routes.js:68 | authenticate / requireSuperAdmin | adminController.listUsers |
| POST | `/api/v1/admin/platform/users/:id/impersonate` | backend/src/routes/admin.routes.js:69 | authenticate / requireSuperAdmin | adminController.impersonateUser |
| GET | `/api/v1/admin/platform/webhooks` | backend/src/routes/admin.routes.js:25 | authenticate / requireSuperAdmin | adminController.inspectWebhooks |
| POST | `/api/v1/admin/platform/webhooks/repair` | backend/src/routes/admin.routes.js:26 | authenticate / requireSuperAdmin | adminController.repairWebhooks |
| GET | `/api/v1/admin/platform/workspaces` | backend/src/routes/admin.routes.js:49 | authenticate / requireSuperAdmin | adminController.listWorkspacesDetailed |
| POST | `/api/v1/admin/platform/workspaces/:id/invitations` | backend/src/routes/admin.routes.js:62 | authenticate / requireSuperAdmin / validate({ body: invitationSchemas.create }) | adminController.workspaceInvite |
| DELETE | `/api/v1/admin/platform/workspaces/:id/invitations/:invitationId` | backend/src/routes/admin.routes.js:64 | authenticate / requireSuperAdmin | adminController.workspaceRevokeInvite |
| POST | `/api/v1/admin/platform/workspaces/:id/invitations/link` | backend/src/routes/admin.routes.js:63 | authenticate / requireSuperAdmin / validate({ body: invitationSchemas.createLink }) | adminController.workspaceInviteLink |
| GET | `/api/v1/admin/platform/workspaces/:id/members` | backend/src/routes/admin.routes.js:59 | authenticate / requireSuperAdmin | adminController.workspaceMembers |
| PATCH | `/api/v1/admin/platform/workspaces/:id/suspend` | backend/src/routes/admin.routes.js:50 | authenticate / requireSuperAdmin | adminController.suspendWorkspace |
| GET | `/api/v1/admin/platform/workspaces/analytics` | backend/src/routes/admin.routes.js:58 | authenticate / requireSuperAdmin | adminController.workspaceAnalytics |
| POST | `/api/v1/admin/twilio/sync` | backend/src/routes/admin.routes.js:39 | authenticate / requireSuperAdmin | adminController.twilioSync |
| GET | `/api/v1/admin/waba/numbers` | backend/src/routes/admin.routes.js:42 | authenticate / requireSuperAdmin | adminController.getWabaNumbers |
| GET | `/api/v1/admin/workspaces` | backend/src/routes/admin.routes.js:29 | authenticate / requireSuperAdmin | adminController.listWorkspaces |
| POST | `/api/v1/ai/campaign/create` | backend/src/routes/ai.routes.js:10 | authenticate | createCampaign |
| POST | `/api/v1/ai/campaign/update` | backend/src/routes/ai.routes.js:11 | authenticate | updateCampaign |
| POST | `/api/v1/ai/template/create` | backend/src/routes/ai.routes.js:9 | authenticate | createTemplate |
| POST | `/api/v1/ai/template/update` | backend/src/routes/ai.routes.js:12 | authenticate | updateTemplate |
| POST | `/api/v1/ai/workflow/execute` | backend/src/routes/ai.routes.js:13 | authenticate | executeWorkflow |
| POST | `/api/v1/assistant/chat` | backend/src/routes/assistant.routes.js:16 | rateLimit({ windowMs: 60_000, max: 12, keyPrefix: 'assistant' }) | controller.chat |
| POST | `/api/v1/assistant/reindex` | backend/src/routes/assistant.routes.js:23 | authenticate / requireSuperAdmin | controller.reindex |
| GET | `/api/v1/assistant/status` | backend/src/routes/assistant.routes.js:20 |  | controller.status |
| POST | `/api/v1/auth/exchange` | backend/src/routes/auth.routes.js:131 | refreshLimiter | authController.exchangeOneTimeCode |
| POST | `/api/v1/auth/forgot-password` | backend/src/routes/auth.routes.js:92 | otpLimiter / validate({ body: authSchemas.forgotPassword }) | authController.forgotPassword |
| GET | `/api/v1/auth/google` | backend/src/routes/auth.routes.js:146 |  | (req, res, next) => { const inviteToken = typeof req.query.invite === 'string' ? |
| GET | `/api/v1/auth/google/callback` | backend/src/routes/auth.routes.js:169 |  | (req, res, next) => { const statePayload = verifyState(req.query.state |
| GET | `/api/v1/auth/instagram/callback` | backend/src/routes/auth.routes.js:521 |  | instagramController.oauthCallback |
| POST | `/api/v1/auth/login` | backend/src/routes/auth.routes.js:106 | loginLimiter / validate({ body: authSchemas.login }) | authController.login |
| POST | `/api/v1/auth/logout` | backend/src/routes/auth.routes.js:123 | authenticateOptional | authController.logout |
| GET | `/api/v1/auth/meta/callback` | backend/src/routes/auth.routes.js:324 |  | async (req, res) => { const { code, state } = req.query; const { env } = await i |
| GET | `/api/v1/auth/meta/start` | backend/src/routes/auth.routes.js:242 | authenticate | async (req, res) => { const workspaceId = req.query.workspaceId // req.user.work |
| POST | `/api/v1/auth/refresh` | backend/src/routes/auth.routes.js:113 | refreshLimiter / validate({ body: authSchemas.refresh }) | authController.refresh |
| POST | `/api/v1/auth/register/resend` | backend/src/routes/auth.routes.js:82 | otpLimiter / validate({ body: authSchemas.signupResend }) | authController.resendSignupOtp |
| POST | `/api/v1/auth/register/start` | backend/src/routes/auth.routes.js:68 | otpLimiter / validate({ body: authSchemas.signupStart }) | authController.startSignup |
| POST | `/api/v1/auth/register/verify` | backend/src/routes/auth.routes.js:75 | loginLimiter / validate({ body: authSchemas.signupVerify }) | authController.verifySignup |
| POST | `/api/v1/auth/reset-password` | backend/src/routes/auth.routes.js:99 | loginLimiter / validate({ body: authSchemas.resetPassword }) | authController.resetPassword |
| POST | `/api/v1/authentication/generate` | backend/src/authentication/authentication.routes.js:13 | authenticateApiKey / requireScope('authentication:send') | authenticationController.generateOtp |
| POST | `/api/v1/authentication/verify` | backend/src/authentication/authentication.routes.js:20 | authenticateApiKey / requireScope('authentication:send') | authenticationController.verifyOtp |
| GET | `/api/v1/forms/:workspaceId/:slug` | backend/src/routes/publicForms.routes.js:13 | rateLimit({ windowMs: 60_000, max: 60, keyPrefix: 'form-get' }) | formsController.publicGet |
| POST | `/api/v1/forms/:workspaceId/:slug` | backend/src/routes/publicForms.routes.js:21 | rateLimit({ windowMs: 60_000, max: 10, keyPrefix: 'form-post' }) / validate({ body: leadFormSchemas.submit }) | formsController.publicSubmit |
| GET | `/api/v1/health` | backend/src/routes/index.js |  | inline |
| GET | `/api/v1/integrations/oauth/` | backend/src/routes/integrations.routes.js:13 | authenticate / workspaceContext | controller.list |
| DELETE | `/api/v1/integrations/oauth/:provider` | backend/src/routes/integrations.routes.js:17 | authenticate / workspaceContext | controller.disconnect |
| POST | `/api/v1/integrations/oauth/:provider` | backend/src/routes/integrations.routes.js:16 | authenticate / workspaceContext | controller.connect |
| GET | `/api/v1/integrations/oauth/:provider/callback` | backend/src/routes/integrations.routes.js:25 |  | controller.oauthCallback |
| POST | `/api/v1/integrations/oauth/oauth/:provider/start` | backend/src/routes/integrations.routes.js:15 | authenticate / workspaceContext | controller.oauthStart |
| GET | `/api/v1/integrations/oauth/oauth/providers` | backend/src/routes/integrations.routes.js:14 | authenticate / workspaceContext | controller.oauthProviders |
| GET | `/api/v1/invitations/` | backend/src/routes/invitations.routes.js:24 | authenticate / workspaceContext | controller.list |
| POST | `/api/v1/invitations/` | backend/src/routes/invitations.routes.js:21 | authenticate / workspaceContext / inviteLimiter / authorize('ADMIN') / validate({ body: invitationSchemas.create }) | controller.create |
| DELETE | `/api/v1/invitations/:id` | backend/src/routes/invitations.routes.js:26 | authenticate / workspaceContext / authorize('ADMIN') | controller.revoke |
| POST | `/api/v1/invitations/:id/resend` | backend/src/routes/invitations.routes.js:25 | authenticate / workspaceContext / inviteLimiter / authorize('ADMIN') | controller.resend |
| GET | `/api/v1/invitations/:token` | backend/src/routes/invitations.routes.js:35 | tokenLimiter | controller.getByToken |
| POST | `/api/v1/invitations/:token/accept` | backend/src/routes/invitations.routes.js:36 | tokenLimiter / authenticate | controller.accept |
| POST | `/api/v1/invitations/link` | backend/src/routes/invitations.routes.js:23 | authenticate / workspaceContext / inviteLimiter / authorize('ADMIN') / validate({ body: invitationSchemas.createLink }) | controller.createLink |
| GET | `/api/v1/notifications/` | backend/src/routes/notifications.routes.js:13 | authenticate | notificationsController.list |
| POST | `/api/v1/notifications/:id/read` | backend/src/routes/notifications.routes.js:16 | authenticate | notificationsController.markRead |
| POST | `/api/v1/notifications/read-all` | backend/src/routes/notifications.routes.js:15 | authenticate | notificationsController.markAllRead |
| GET | `/api/v1/notifications/unread-count` | backend/src/routes/notifications.routes.js:14 | authenticate | notificationsController.unreadCount |
| GET | `/api/v1/oauth/authorize` | backend/src/routes/oauth.routes.js:25 | express.urlencoded({ extended: false }) / express.json() / authorizeLimiter | ctrl.authorize |
| GET | `/api/v1/oauth/consent-info` | backend/src/routes/oauth.routes.js:26 | express.urlencoded({ extended: false }) / express.json() / authenticate / decideLimiter | ctrl.consentInfo |
| POST | `/api/v1/oauth/consent/decide` | backend/src/routes/oauth.routes.js:27 | express.urlencoded({ extended: false }) / express.json() / authenticate / decideLimiter | ctrl.decide |
| POST | `/api/v1/oauth/revoke` | backend/src/routes/oauth.routes.js:31 | express.urlencoded({ extended: false }) / express.json() / tokenLimiter | ctrl.revoke |
| POST | `/api/v1/oauth/token` | backend/src/routes/oauth.routes.js:30 | express.urlencoded({ extended: false }) / express.json() / tokenLimiter | ctrl.token |
| POST | `/api/v1/onboarding/chat` | backend/src/routes/onboarding.routes.js:10 | authenticate / rateLimit({ windowMs: 60_000, max: 30, keyPrefix: 'ai-chat' }) | chatWithAi |
| GET | `/api/v1/pricing` | backend/src/routes/index.js |  | inline |
| GET | `/api/v1/public/ai-agent/config` | backend/src/routes/public.routes.js:70 | authenticateApiKey / requireScope('ai-agent:read') | injectWorkspace(aiAgentController.getConfig) |
| POST | `/api/v1/public/ai-agent/query` | backend/src/routes/public.routes.js:71 | authenticateApiKey / requireScope('ai-agent:write') | injectWorkspace(aiAgentController.test) |
| GET | `/api/v1/public/analytics/summary` | backend/src/routes/public.routes.js:64 | authenticateApiKey / requireScope('analytics:read') | injectWorkspace(analyticsController.overview) |
| GET | `/api/v1/public/automations` | backend/src/routes/public.routes.js:74 | authenticateApiKey / requireScope('automations:read') | injectWorkspace(automationController.list) |
| GET | `/api/v1/public/campaigns` | backend/src/routes/public.routes.js:51 | authenticateApiKey / requireScope('campaigns:read') | injectWorkspace(campaignsController.list) |
| POST | `/api/v1/public/campaigns` | backend/src/routes/public.routes.js:52 | authenticateApiKey / requireScope('campaigns:write') / validate({ body: campaignSchemas.create }) | injectWorkspace(campaignsController.create) |
| GET | `/api/v1/public/campaigns/:id` | backend/src/routes/public.routes.js:53 | authenticateApiKey / requireScope('campaigns:read') | injectWorkspace(campaignsController.getOne) |
| POST | `/api/v1/public/campaigns/:id/launch` | backend/src/routes/public.routes.js:56 | authenticateApiKey / requireScope('campaigns:write') | injectWorkspace(campaignsController.launch) |
| POST | `/api/v1/public/campaigns/:id/recipients` | backend/src/routes/public.routes.js:54 | authenticateApiKey / requireScope('campaigns:write') / validate({ body: campaignSchemas.addRecipients }) | injectWorkspace(campaignsController.addRecipients) |
| PUT | `/api/v1/public/campaigns/:id/recipients` | backend/src/routes/public.routes.js:55 | authenticateApiKey / requireScope('campaigns:write') / validate({ body: campaignSchemas.setRecipients }) | injectWorkspace(campaignsController.setRecipients) |
| GET | `/api/v1/public/contacts` | backend/src/routes/public.routes.js:59 | authenticateApiKey / requireScope('contacts:read') | injectWorkspace(contactsController.list) |
| POST | `/api/v1/public/contacts` | backend/src/routes/public.routes.js:60 | authenticateApiKey / requireScope('contacts:write') | injectWorkspace(contactsController.create) |
| PUT | `/api/v1/public/contacts/:id` | backend/src/routes/public.routes.js:61 | authenticateApiKey / requireScope('contacts:write') | injectWorkspace(contactsController.update) |
| GET | `/api/v1/public/me` | backend/src/routes/public.routes.js:33 | authenticateApiKey | publicIdentityController.me |
| POST | `/api/v1/public/messages` | backend/src/routes/public.routes.js:36 | authenticateApiKey / requireScope('messages:send') | async (req, res, next) => { try { const result = await whatsappService.sendPubli |
| GET | `/api/v1/public/templates` | backend/src/routes/public.routes.js:46 | authenticateApiKey / requireScope('templates:read') | injectWorkspace(templatesController.list) |
| POST | `/api/v1/public/templates` | backend/src/routes/public.routes.js:47 | authenticateApiKey / requireScope('templates:write') / validate({ body: templateSchemas.create }) | injectWorkspace(templatesController.create) |
| GET | `/api/v1/public/templates/:id` | backend/src/routes/public.routes.js:48 | authenticateApiKey / requireScope('templates:read') | injectWorkspace(templatesController.getOne) |
| GET | `/api/v1/public/wallet/balance` | backend/src/routes/public.routes.js:67 | authenticateApiKey / requireScope('wallet:read') | injectWorkspace(walletController.getWallet) |
| POST | `/api/v1/public/webhooks` | backend/src/routes/public.routes.js:78 | authenticateApiKey / requireScope('webhooks:write') | async (req, res, next) => { try { const { webhookUrl } = req.body; if (typeof we |
| DELETE | `/api/v1/users/me` | backend/src/routes/users.routes.js:18 | authenticate / validate({ body: userSchemas.deleteAccount }) | usersController.deleteMe |
| GET | `/api/v1/users/me` | backend/src/routes/users.routes.js:11 | authenticate | usersController.getMe |
| PATCH | `/api/v1/users/me` | backend/src/routes/users.routes.js:12 | authenticate / validate({ body: userSchemas.updateProfile }) | usersController.updateMe |
| GET | `/api/v1/users/me/deletion-preview` | backend/src/routes/users.routes.js:17 | authenticate | usersController.deletionPreview |
| POST | `/api/v1/users/me/password` | backend/src/routes/users.routes.js:13 | authenticate / validate({ body: userSchemas.changePassword }) | usersController.changePassword |
| GET | `/api/v1/users/me/sessions` | backend/src/routes/users.routes.js:14 | authenticate | usersController.listSessions |
| POST | `/api/v1/users/me/sessions/revoke-others` | backend/src/routes/users.routes.js:15 | authenticate | usersController.revokeOtherSessions |
| POST | `/api/v1/voice/incoming` | backend/src/routes/voice.routes.js:8 | ctrl.verifyTwilioSignature | ctrl.incoming |
| POST | `/api/v1/voice/respond` | backend/src/routes/voice.routes.js:9 | ctrl.verifyTwilioSignature | ctrl.respond |
| POST | `/api/v1/voice/status` | backend/src/routes/voice.routes.js:10 | ctrl.verifyTwilioSignature | ctrl.status |
| GET | `/api/v1/webhook/instagram` | backend/src/routes/index.js |  | instagramController.verifyWebhook |
| POST | `/api/v1/webhook/instagram` | backend/src/routes/index.js |  | instagramController.receiveWebhook |
| GET | `/api/v1/webhook/meta` | backend/src/routes/webhook.routes.js:6 |  | webhookController.verify |
| POST | `/api/v1/webhook/meta` | backend/src/routes/webhook.routes.js:7 |  | webhookController.receive |
| POST | `/api/v1/workspaces/` | backend/src/routes/workspaces.routes.js:10 | authenticate / validate({ body: workspaceSchemas.create }) | async (req, res) => { const result = await authService.createWorkspace(req.user. |
| GET | `/api/v1/workspaces/:workspaceId/activities/` | backend/src/routes/activities.routes.js:12 | authenticate / workspaceContext | activitiesController.list |
| POST | `/api/v1/workspaces/:workspaceId/activities/` | backend/src/routes/activities.routes.js:13 | authenticate / workspaceContext / authorize('AGENT') / validate({ body: crmActivitySchemas.create }) | activitiesController.create |
| DELETE | `/api/v1/workspaces/:workspaceId/activities/:id` | backend/src/routes/activities.routes.js:14 | authenticate / workspaceContext / authorize('CLIENT') | activitiesController.remove |
| PATCH | `/api/v1/workspaces/:workspaceId/agent/facts/:factId` | backend/src/routes/agent.routes.js:16 | authenticate / workspaceContext / authorize('CLIENT') | agentController.settle |
| GET | `/api/v1/workspaces/:workspaceId/agent/history/:targetType/:targetId` | backend/src/routes/agent.routes.js:11 | authenticate / workspaceContext | agentController.history |
| GET | `/api/v1/workspaces/:workspaceId/agent/pending` | backend/src/routes/agent.routes.js:12 | authenticate / workspaceContext | agentController.pending |
| POST | `/api/v1/workspaces/:workspaceId/agent/run` | backend/src/routes/agent.routes.js:17 | authenticate / workspaceContext / authorize('ADMIN') | agentController.runNow |
| GET | `/api/v1/workspaces/:workspaceId/ai-agent/agents` | backend/src/routes/aiAgent.routes.js:13 | authenticate / workspaceContext | ctrl.agents |
| GET | `/api/v1/workspaces/:workspaceId/ai-agent/campaigns` | backend/src/routes/aiAgent.routes.js:14 | authenticate / workspaceContext | ctrl.campaignUsage |
| GET | `/api/v1/workspaces/:workspaceId/ai-agent/config` | backend/src/routes/aiAgent.routes.js:10 | authenticate / workspaceContext | ctrl.getConfig |
| PATCH | `/api/v1/workspaces/:workspaceId/ai-agent/config` | backend/src/routes/aiAgent.routes.js:15 | authenticate / workspaceContext | ctrl.updateConfig |
| POST | `/api/v1/workspaces/:workspaceId/ai-agent/deploy` | backend/src/routes/aiAgent.routes.js:21 | authenticate / workspaceContext | ctrl.deploy |
| PATCH | `/api/v1/workspaces/:workspaceId/ai-agent/intent-matching` | backend/src/routes/aiAgent.routes.js:24 | authenticate / workspaceContext | ctrl.setIntent |
| POST | `/api/v1/workspaces/:workspaceId/ai-agent/knowledge/upload` | backend/src/routes/aiAgent.routes.js:17 | authenticate / workspaceContext / uploader(ACCEPTS.knowledge, 10 * 1024 * 1024).single('file') / verifyFileContents | ctrl.uploadKnowledge |
| POST | `/api/v1/workspaces/:workspaceId/ai-agent/test` | backend/src/routes/aiAgent.routes.js:23 | authenticate / workspaceContext | ctrl.test |
| POST | `/api/v1/workspaces/:workspaceId/ai-agent/undeploy` | backend/src/routes/aiAgent.routes.js:22 | authenticate / workspaceContext | ctrl.undeploy |
| GET | `/api/v1/workspaces/:workspaceId/ai-agents/` | backend/src/routes/aiAgents.routes.js:10 | authenticate / workspaceContext | aiAgentsController.listAgents |
| POST | `/api/v1/workspaces/:workspaceId/ai-agents/` | backend/src/routes/aiAgents.routes.js:11 | authenticate / workspaceContext | aiAgentsController.createAgent |
| DELETE | `/api/v1/workspaces/:workspaceId/ai-agents/:id` | backend/src/routes/aiAgents.routes.js:13 | authenticate / workspaceContext | aiAgentsController.deleteAgent |
| PUT | `/api/v1/workspaces/:workspaceId/ai-agents/:id` | backend/src/routes/aiAgents.routes.js:12 | authenticate / workspaceContext | aiAgentsController.updateAgent |
| POST | `/api/v1/workspaces/:workspaceId/ai-agents/:id/test` | backend/src/routes/aiAgents.routes.js:21 | authenticate / workspaceContext | aiAgentsController.testAgent |
| GET | `/api/v1/workspaces/:workspaceId/ai-agents/actions` | backend/src/routes/aiAgents.routes.js:19 | authenticate / workspaceContext | aiAgentsController.listActions |
| POST | `/api/v1/workspaces/:workspaceId/ai-agents/actions/execute` | backend/src/routes/aiAgents.routes.js:20 | authenticate / workspaceContext | aiAgentsController.executeAction |
| GET | `/api/v1/workspaces/:workspaceId/ai-agents/channels` | backend/src/routes/aiAgents.routes.js:15 | authenticate / workspaceContext | aiAgentsController.listChannels |
| PUT | `/api/v1/workspaces/:workspaceId/ai-agents/channels/:channelKey` | backend/src/routes/aiAgents.routes.js:16 | authenticate / workspaceContext | aiAgentsController.updateChannel |
| GET | `/api/v1/workspaces/:workspaceId/ai-agents/guidelines` | backend/src/routes/aiAgents.routes.js:18 | authenticate / workspaceContext | aiAgentsController.listGuidelines |
| GET | `/api/v1/workspaces/:workspaceId/analytics/agents` | backend/src/routes/analytics.routes.js:13 | authenticate / workspaceContext | analyticsController.agents |
| GET | `/api/v1/workspaces/:workspaceId/analytics/audience` | backend/src/routes/analytics.routes.js:14 | authenticate / workspaceContext | analyticsController.audience |
| GET | `/api/v1/workspaces/:workspaceId/analytics/campaigns` | backend/src/routes/analytics.routes.js:12 | authenticate / workspaceContext | analyticsController.campaigns |
| GET | `/api/v1/workspaces/:workspaceId/analytics/chat` | backend/src/routes/analytics.routes.js:17 | authenticate / workspaceContext | analyticsController.getChatAnalytics |
| GET | `/api/v1/workspaces/:workspaceId/analytics/delivery` | backend/src/routes/analytics.routes.js:11 | authenticate / workspaceContext | analyticsController.delivery |
| GET | `/api/v1/workspaces/:workspaceId/analytics/insights` | backend/src/routes/analytics.routes.js:15 | authenticate / workspaceContext | analyticsController.insights |
| GET | `/api/v1/workspaces/:workspaceId/analytics/overview` | backend/src/routes/analytics.routes.js:10 | authenticate / workspaceContext | analyticsController.overview |
| GET | `/api/v1/workspaces/:workspaceId/analytics/paid-messages` | backend/src/routes/analytics.routes.js:18 | authenticate / workspaceContext | analyticsController.paidMessages |
| GET | `/api/v1/workspaces/:workspaceId/analytics/performance` | backend/src/routes/analytics.routes.js:16 | authenticate / workspaceContext | analyticsController.performance |
| GET | `/api/v1/workspaces/:workspaceId/api-keys/` | backend/src/routes/apikeys.routes.js:10 | authenticate / workspaceContext | apiKeysController.list |
| POST | `/api/v1/workspaces/:workspaceId/api-keys/` | backend/src/routes/apikeys.routes.js:32 | authenticate / workspaceContext / validate({ body: apiKeySchemas.create }) | apiKeysController.create |
| DELETE | `/api/v1/workspaces/:workspaceId/api-keys/:id` | backend/src/routes/apikeys.routes.js:40 | authenticate / workspaceContext | apiKeysController.revoke |
| POST | `/api/v1/workspaces/:workspaceId/api-keys/:id/rotate` | backend/src/routes/apikeys.routes.js:38 | authenticate / workspaceContext | apiKeysController.rotate |
| GET | `/api/v1/workspaces/:workspaceId/api-keys/authentication` | backend/src/routes/apikeys.routes.js:18 | authenticate / workspaceContext | apiKeysController.getAuthentication |
| POST | `/api/v1/workspaces/:workspaceId/api-keys/authentication/rotate` | backend/src/routes/apikeys.routes.js:23 | authenticate / workspaceContext | apiKeysController.rotateAuthentication |
| GET | `/api/v1/workspaces/:workspaceId/api-keys/scopes` | backend/src/routes/apikeys.routes.js:30 | authenticate / workspaceContext | apiKeysController.scopes |
| GET | `/api/v1/workspaces/:workspaceId/authentication/` | backend/src/authentication/authentication-config.routes.js:21 | authenticate / workspaceContext | authenticationConfigController.getConfiguration |
| PATCH | `/api/v1/workspaces/:workspaceId/authentication/` | backend/src/authentication/authentication-config.routes.js:27 | authenticate / workspaceContext | authenticationConfigController.updateConfiguration |
| GET | `/api/v1/workspaces/:workspaceId/authentication/analytics` | backend/src/authentication/authentication-config.routes.js:15 | authenticate / workspaceContext | authenticationConfigController.getUsage |
| GET | `/api/v1/workspaces/:workspaceId/automation/basic` | backend/src/routes/automation.routes.js:23 | authenticate / workspaceContext / requireFeature('automation') | automationController.getBasicAutomations |
| PATCH | `/api/v1/workspaces/:workspaceId/automation/basic` | backend/src/routes/automation.routes.js:24 | authenticate / workspaceContext / requireFeature('automation') / authorize('CLIENT') / validate({ body: automationSchemas.updateBasic }) | automationController.updateBasicAutomations |
| GET | `/api/v1/workspaces/:workspaceId/automation/triggers` | backend/src/routes/automation.routes.js:18 | authenticate / workspaceContext / requireFeature('automation') | automationController.list |
| POST | `/api/v1/workspaces/:workspaceId/automation/triggers` | backend/src/routes/automation.routes.js:19 | authenticate / workspaceContext / requireFeature('automation') / authorize('CLIENT') / validate({ body: automationSchemas.createTrigger }) | automationController.create |
| DELETE | `/api/v1/workspaces/:workspaceId/automation/triggers/:id` | backend/src/routes/automation.routes.js:21 | authenticate / workspaceContext / requireFeature('automation') / authorize('CLIENT') | automationController.remove |
| PATCH | `/api/v1/workspaces/:workspaceId/automation/triggers/:id` | backend/src/routes/automation.routes.js:20 | authenticate / workspaceContext / requireFeature('automation') / authorize('CLIENT') / validate({ body: automationSchemas.updateTrigger }) | automationController.update |
| GET | `/api/v1/workspaces/:workspaceId/automation/voice` | backend/src/routes/automation.routes.js:26 | authenticate / workspaceContext / requireFeature('automation') | automationController.getVoiceSettings |
| PATCH | `/api/v1/workspaces/:workspaceId/automation/voice` | backend/src/routes/automation.routes.js:27 | authenticate / workspaceContext / requireFeature('automation') / authorize('CLIENT') | automationController.updateVoiceSettings |
| GET | `/api/v1/workspaces/:workspaceId/automation/voice/calls` | backend/src/routes/automation.routes.js:28 | authenticate / workspaceContext / requireFeature('automation') | voiceController.listCalls |
| POST | `/api/v1/workspaces/:workspaceId/automation/workflows/ai-preview` | backend/src/routes/automation.routes.js:25 | authenticate / workspaceContext / requireFeature('automation') / authorize('CLIENT') | automationController.generateWorkflowPreview |
| GET | `/api/v1/workspaces/:workspaceId/blocked-numbers/` | backend/src/routes/optout.routes.js:13 | authenticate / workspaceContext | optOutController.list |
| POST | `/api/v1/workspaces/:workspaceId/blocked-numbers/` | backend/src/routes/optout.routes.js:16 | authenticate / workspaceContext / validate({ body: optOutSchemas.block }) | optOutController.block |
| DELETE | `/api/v1/workspaces/:workspaceId/blocked-numbers/:id` | backend/src/routes/optout.routes.js:18 | authenticate / workspaceContext | optOutController.unblock |
| GET | `/api/v1/workspaces/:workspaceId/blocked-numbers/export` | backend/src/routes/optout.routes.js:15 | authenticate / workspaceContext | optOutController.exportCsv |
| GET | `/api/v1/workspaces/:workspaceId/blocked-numbers/keywords` | backend/src/routes/optout.routes.js:14 | authenticate / workspaceContext | optOutController.keywords |
| POST | `/api/v1/workspaces/:workspaceId/blocked-numbers/unblock` | backend/src/routes/optout.routes.js:17 | authenticate / workspaceContext / validate({ body: optOutSchemas.bulkUnblock }) | optOutController.unblock |
| GET | `/api/v1/workspaces/:workspaceId/campaigns/` | backend/src/routes/campaigns.routes.js:17 | authenticate / workspaceContext | campaignsController.list |
| POST | `/api/v1/workspaces/:workspaceId/campaigns/` | backend/src/routes/campaigns.routes.js:19 | authenticate / workspaceContext / authorize('CLIENT') / validate({ body: campaignSchemas.create }) | campaignsController.create |
| GET | `/api/v1/workspaces/:workspaceId/campaigns/:id` | backend/src/routes/campaigns.routes.js:21 | authenticate / workspaceContext | campaignsController.getOne |
| PATCH | `/api/v1/workspaces/:workspaceId/campaigns/:id` | backend/src/routes/campaigns.routes.js:22 | authenticate / workspaceContext / authorize('CLIENT') / validate({ body: campaignSchemas.update }) | campaignsController.update |
| PUT | `/api/v1/workspaces/:workspaceId/campaigns/:id` | backend/src/routes/campaigns.routes.js:23 | authenticate / workspaceContext / authorize('CLIENT') / validate({ body: campaignSchemas.update }) | campaignsController.update |
| PATCH | `/api/v1/workspaces/:workspaceId/campaigns/:id/cancel` | backend/src/routes/campaigns.routes.js:28 | authenticate / workspaceContext / authorize('CLIENT') | campaignsController.cancel |
| POST | `/api/v1/workspaces/:workspaceId/campaigns/:id/launch` | backend/src/routes/campaigns.routes.js:27 | authenticate / workspaceContext / authorize('CLIENT') / validate({ body: campaignSchemas.launch }) | campaignsController.launch |
| PATCH | `/api/v1/workspaces/:workspaceId/campaigns/:id/pause` | backend/src/routes/campaigns.routes.js:30 | authenticate / workspaceContext / authorize('CLIENT') | campaignsController.pause |
| POST | `/api/v1/workspaces/:workspaceId/campaigns/:id/recipients` | backend/src/routes/campaigns.routes.js:24 | authenticate / workspaceContext / authorize('CLIENT') / validate({ body: campaignSchemas.addRecipients }) | campaignsController.addRecipients |
| PUT | `/api/v1/workspaces/:workspaceId/campaigns/:id/recipients` | backend/src/routes/campaigns.routes.js:26 | authenticate / workspaceContext / authorize('CLIENT') / validate({ body: campaignSchemas.setRecipients }) | campaignsController.setRecipients |
| PATCH | `/api/v1/workspaces/:workspaceId/campaigns/:id/resume` | backend/src/routes/campaigns.routes.js:31 | authenticate / workspaceContext / authorize('CLIENT') | campaignsController.resume |
| POST | `/api/v1/workspaces/:workspaceId/campaigns/estimate` | backend/src/routes/campaigns.routes.js:20 | authenticate / workspaceContext / authorize('CLIENT') / validate({ body: campaignSchemas.estimate }) | campaignsController.estimate |
| GET | `/api/v1/workspaces/:workspaceId/campaigns/fallback-capabilities` | backend/src/routes/campaigns.routes.js:18 | authenticate / workspaceContext | campaignsController.fallbackCapabilities |
| GET | `/api/v1/workspaces/:workspaceId/clusters/` | backend/src/routes/clusters.routes.js:11 | authenticate / workspaceContext | clustersController.list |
| POST | `/api/v1/workspaces/:workspaceId/clusters/` | backend/src/routes/clusters.routes.js:12 | authenticate / workspaceContext / validate({ body: clusterSchemas.create }) | clustersController.create |
| DELETE | `/api/v1/workspaces/:workspaceId/clusters/:clusterId` | backend/src/routes/clusters.routes.js:16 | authenticate / workspaceContext | clustersController.remove |
| GET | `/api/v1/workspaces/:workspaceId/clusters/:clusterId` | backend/src/routes/clusters.routes.js:13 | authenticate / workspaceContext | clustersController.get |
| PATCH | `/api/v1/workspaces/:workspaceId/clusters/:clusterId` | backend/src/routes/clusters.routes.js:15 | authenticate / workspaceContext / validate({ body: clusterSchemas.update }) | clustersController.update |
| PUT | `/api/v1/workspaces/:workspaceId/clusters/:clusterId` | backend/src/routes/clusters.routes.js:14 | authenticate / workspaceContext / validate({ body: clusterSchemas.update }) | clustersController.update |
| GET | `/api/v1/workspaces/:workspaceId/contacts/` | backend/src/routes/contacts.routes.js:14 | authenticate / workspaceContext | contactsController.list |
| POST | `/api/v1/workspaces/:workspaceId/contacts/` | backend/src/routes/contacts.routes.js:15 | authenticate / workspaceContext / validate({ body: contactSchemas.create }) | contactsController.create |
| DELETE | `/api/v1/workspaces/:workspaceId/contacts/:id` | backend/src/routes/contacts.routes.js:22 | authenticate / workspaceContext | contactsController.remove |
| GET | `/api/v1/workspaces/:workspaceId/contacts/:id` | backend/src/routes/contacts.routes.js:21 | authenticate / workspaceContext | contactsController.getOne |
| PATCH | `/api/v1/workspaces/:workspaceId/contacts/:id` | backend/src/routes/contacts.routes.js:23 | authenticate / workspaceContext / validate({ body: contactSchemas.update }) | contactsController.update |
| GET | `/api/v1/workspaces/:workspaceId/contacts/export` | backend/src/routes/contacts.routes.js:20 | authenticate / workspaceContext | contactsController.exportCsv |
| POST | `/api/v1/workspaces/:workspaceId/contacts/import` | backend/src/routes/contacts.routes.js:16 | authenticate / workspaceContext / upload.single('file') / verifyFileContents | contactsController.importCsv |
| GET | `/api/v1/workspaces/:workspaceId/contacts/tags` | backend/src/routes/contacts.routes.js:18 | authenticate / workspaceContext | contactsController.tags |
| GET | `/api/v1/workspaces/:workspaceId/conversations/` | backend/src/routes/conversations.routes.js:11 | authenticate / workspaceContext | conversationsController.list |
| POST | `/api/v1/workspaces/:workspaceId/conversations/` | backend/src/routes/conversations.routes.js:12 | authenticate / workspaceContext | conversationsController.createOrGet |
| PATCH | `/api/v1/workspaces/:workspaceId/conversations/:id/assign` | backend/src/routes/conversations.routes.js:19 | authenticate / workspaceContext | conversationsController.assign |
| PATCH | `/api/v1/workspaces/:workspaceId/conversations/:id/bot` | backend/src/routes/conversations.routes.js:23 | authenticate / workspaceContext | conversationsController.setBot |
| GET | `/api/v1/workspaces/:workspaceId/conversations/:id/context` | backend/src/routes/conversations.routes.js:14 | authenticate / workspaceContext | conversationsController.context |
| POST | `/api/v1/workspaces/:workspaceId/conversations/:id/inbound-simulate` | backend/src/routes/conversations.routes.js:26 | authenticate / workspaceContext | conversationsController.simulateInbound |
| POST | `/api/v1/workspaces/:workspaceId/conversations/:id/media` | backend/src/routes/conversations.routes.js:32 | authenticate / workspaceContext / uploader(ACCEPTS.outboundMedia, 100 * 1024 * 1024).single('file') / verifyFileContents | conversationsController.sendMedia |
| GET | `/api/v1/workspaces/:workspaceId/conversations/:id/messages` | backend/src/routes/conversations.routes.js:13 | authenticate / workspaceContext | conversationsController.getMessages |
| POST | `/api/v1/workspaces/:workspaceId/conversations/:id/messages` | backend/src/routes/conversations.routes.js:24 | authenticate / workspaceContext | conversationsController.sendMessage |
| GET | `/api/v1/workspaces/:workspaceId/conversations/:id/notes` | backend/src/routes/conversations.routes.js:16 | authenticate / workspaceContext | conversationsController.listNotes |
| POST | `/api/v1/workspaces/:workspaceId/conversations/:id/notes` | backend/src/routes/conversations.routes.js:17 | authenticate / workspaceContext | conversationsController.addNote |
| DELETE | `/api/v1/workspaces/:workspaceId/conversations/:id/notes/:noteId` | backend/src/routes/conversations.routes.js:18 | authenticate / workspaceContext | conversationsController.deleteNote |
| POST | `/api/v1/workspaces/:workspaceId/conversations/:id/reopen-window` | backend/src/routes/conversations.routes.js:25 | authenticate / workspaceContext | conversationsController.reopenWindow |
| PATCH | `/api/v1/workspaces/:workspaceId/conversations/:id/status` | backend/src/routes/conversations.routes.js:20 | authenticate / workspaceContext | conversationsController.setStatus |
| POST | `/api/v1/workspaces/:workspaceId/conversations/:id/suggest` | backend/src/routes/conversations.routes.js:15 | authenticate / workspaceContext | conversationsController.suggest |
| POST | `/api/v1/workspaces/:workspaceId/conversations/:id/template` | backend/src/routes/conversations.routes.js:29 | authenticate / workspaceContext | conversationsController.sendTemplate |
| POST | `/api/v1/workspaces/:workspaceId/copilot/ask` | backend/src/routes/copilot.routes.js:15 | authenticate / workspaceContext / rateLimit({ windowMs: 60_000, max: 20, keyPrefix: 'copilot-ask' }) / validate({ body: copilotSchemas.ask }) | copilotController.ask |
| POST | `/api/v1/workspaces/:workspaceId/copilot/confirm` | backend/src/routes/copilot.routes.js:25 | authenticate / workspaceContext / authorize('CLIENT') / validate({ body: copilotSchemas.confirm }) | copilotController.confirm |
| GET | `/api/v1/workspaces/:workspaceId/crm-analytics/` | backend/src/routes/crm-analytics.routes.js:12 | authenticate / workspaceContext | crmAnalyticsController.getAnalytics |
| GET | `/api/v1/workspaces/:workspaceId/crm-analytics/integration-health` | backend/src/routes/crm-analytics.routes.js:13 | authenticate / workspaceContext | crmAnalyticsController.getIntegrationHealth |
| POST | `/api/v1/workspaces/:workspaceId/crm-analytics/reports/query` | backend/src/routes/crm-analytics.routes.js:14 | authenticate / workspaceContext | customReportsController.queryReport |
| GET | `/api/v1/workspaces/:workspaceId/crm-analytics/reports/saved` | backend/src/routes/crm-analytics.routes.js:15 | authenticate / workspaceContext | customReportsController.listSavedReports |
| POST | `/api/v1/workspaces/:workspaceId/crm-analytics/reports/saved` | backend/src/routes/crm-analytics.routes.js:16 | authenticate / workspaceContext / authorize('CLIENT') | customReportsController.saveReport |
| DELETE | `/api/v1/workspaces/:workspaceId/crm-analytics/reports/saved/:id` | backend/src/routes/crm-analytics.routes.js:17 | authenticate / workspaceContext / authorize('CLIENT') | customReportsController.removeReport |
| GET | `/api/v1/workspaces/:workspaceId/crm-customization/` | backend/src/routes/crmCustomization.routes.js:10 | authenticate / workspaceContext | controller.getAllCustomizations |
| GET | `/api/v1/workspaces/:workspaceId/crm-customization/:sectionKey` | backend/src/routes/crmCustomization.routes.js:12 | authenticate / workspaceContext | controller.getSection |
| PUT | `/api/v1/workspaces/:workspaceId/crm-customization/:sectionKey` | backend/src/routes/crmCustomization.routes.js:13 | authenticate / workspaceContext | controller.updateSection |
| GET | `/api/v1/workspaces/:workspaceId/crm-customization/:sectionKey/check-delete` | backend/src/routes/crmCustomization.routes.js:11 | authenticate / workspaceContext | controller.checkSafeDelete |
| POST | `/api/v1/workspaces/:workspaceId/crm-customization/:sectionKey/reset` | backend/src/routes/crmCustomization.routes.js:14 | authenticate / workspaceContext | controller.resetSection |
| GET | `/api/v1/workspaces/:workspaceId/crm-data/export/:entity` | backend/src/routes/crmData.routes.js:15 | authenticate / workspaceContext / authorize('ADMIN') | crmDataController.exportCsv |
| POST | `/api/v1/workspaces/:workspaceId/crm-data/import/leads` | backend/src/routes/crmData.routes.js:18 | authenticate / workspaceContext / authorize('CLIENT') / upload.single('file') | crmDataController.runImport |
| POST | `/api/v1/workspaces/:workspaceId/crm-data/import/leads/preview` | backend/src/routes/crmData.routes.js:17 | authenticate / workspaceContext / authorize('CLIENT') / upload.single('file') | crmDataController.previewImport |
| GET | `/api/v1/workspaces/:workspaceId/crm-permissions/my` | backend/src/routes/crmPermissions.routes.js:10 | authenticate / workspaceContext | crmPermissionsController.getMyCrmPermissions |
| GET | `/api/v1/workspaces/:workspaceId/crm-sales-inbox/audience-review` | backend/src/routes/crmSalesInbox.routes.js:13 | authenticate / workspaceContext | crmSalesInboxController.reviewAudience |
| GET | `/api/v1/workspaces/:workspaceId/crm-sales-inbox/campaign-analytics` | backend/src/routes/crmSalesInbox.routes.js:14 | authenticate / workspaceContext | crmSalesInboxController.getCampaignAnalytics |
| POST | `/api/v1/workspaces/:workspaceId/crm-sales-inbox/launch-bulk-campaign` | backend/src/routes/crmSalesInbox.routes.js:16 | authenticate / workspaceContext / authorize('CLIENT') | crmSalesInboxController.launchBulkCampaign |
| POST | `/api/v1/workspaces/:workspaceId/crm-sales-inbox/leads/:leadId/recalculate-category` | backend/src/routes/crmSalesInbox.routes.js:15 | authenticate / workspaceContext | crmSalesInboxController.recalculateLeadCategory |
| GET | `/api/v1/workspaces/:workspaceId/crm-sales-inbox/segments` | backend/src/routes/crmSalesInbox.routes.js:12 | authenticate / workspaceContext | crmSalesInboxController.getSegments |
| GET | `/api/v1/workspaces/:workspaceId/custom-fields/` | backend/src/routes/customFields.routes.js:29 | authenticate / workspaceContext | cfController.list |
| POST | `/api/v1/workspaces/:workspaceId/custom-fields/` | backend/src/routes/customFields.routes.js:30 | authenticate / workspaceContext / authorize('ADMIN') / validate({ body: customFieldSchemas.create }) | cfController.create |
| DELETE | `/api/v1/workspaces/:workspaceId/custom-fields/:id` | backend/src/routes/customFields.routes.js:32 | authenticate / workspaceContext / authorize('ADMIN') | cfController.remove |
| PATCH | `/api/v1/workspaces/:workspaceId/custom-fields/:id` | backend/src/routes/customFields.routes.js:31 | authenticate / workspaceContext / authorize('ADMIN') / validate({ body: customFieldSchemas.update }) | cfController.update |
| GET | `/api/v1/workspaces/:workspaceId/custom-fields/events` | backend/src/routes/customFields.routes.js:22 | authenticate / workspaceContext | ctrl.listEvents |
| POST | `/api/v1/workspaces/:workspaceId/custom-fields/events` | backend/src/routes/customFields.routes.js:23 | authenticate / workspaceContext / authorize('CLIENT') | ctrl.createEvent |
| DELETE | `/api/v1/workspaces/:workspaceId/custom-fields/events/:id` | backend/src/routes/customFields.routes.js:24 | authenticate / workspaceContext / authorize('CLIENT') | ctrl.deleteEvent |
| POST | `/api/v1/workspaces/:workspaceId/custom-fields/events/:key/track` | backend/src/routes/customFields.routes.js:26 | authenticate / workspaceContext | ctrl.trackEvent |
| GET | `/api/v1/workspaces/:workspaceId/custom-fields/fields` | backend/src/routes/customFields.routes.js:17 | authenticate / workspaceContext | ctrl.listFields |
| POST | `/api/v1/workspaces/:workspaceId/custom-fields/fields` | backend/src/routes/customFields.routes.js:18 | authenticate / workspaceContext / authorize('CLIENT') | ctrl.createField |
| DELETE | `/api/v1/workspaces/:workspaceId/custom-fields/fields/:id` | backend/src/routes/customFields.routes.js:20 | authenticate / workspaceContext / authorize('CLIENT') | ctrl.deleteField |
| PATCH | `/api/v1/workspaces/:workspaceId/custom-fields/fields/:id` | backend/src/routes/customFields.routes.js:19 | authenticate / workspaceContext / authorize('CLIENT') | ctrl.updateField |
| GET | `/api/v1/workspaces/:workspaceId/custom/` | backend/src/routes/customFields.routes.js:29 | authenticate / workspaceContext | cfController.list |
| POST | `/api/v1/workspaces/:workspaceId/custom/` | backend/src/routes/customFields.routes.js:30 | authenticate / workspaceContext / authorize('ADMIN') / validate({ body: customFieldSchemas.create }) | cfController.create |
| DELETE | `/api/v1/workspaces/:workspaceId/custom/:id` | backend/src/routes/customFields.routes.js:32 | authenticate / workspaceContext / authorize('ADMIN') | cfController.remove |
| PATCH | `/api/v1/workspaces/:workspaceId/custom/:id` | backend/src/routes/customFields.routes.js:31 | authenticate / workspaceContext / authorize('ADMIN') / validate({ body: customFieldSchemas.update }) | cfController.update |
| GET | `/api/v1/workspaces/:workspaceId/custom/events` | backend/src/routes/customFields.routes.js:22 | authenticate / workspaceContext | ctrl.listEvents |
| POST | `/api/v1/workspaces/:workspaceId/custom/events` | backend/src/routes/customFields.routes.js:23 | authenticate / workspaceContext / authorize('CLIENT') | ctrl.createEvent |
| DELETE | `/api/v1/workspaces/:workspaceId/custom/events/:id` | backend/src/routes/customFields.routes.js:24 | authenticate / workspaceContext / authorize('CLIENT') | ctrl.deleteEvent |
| POST | `/api/v1/workspaces/:workspaceId/custom/events/:key/track` | backend/src/routes/customFields.routes.js:26 | authenticate / workspaceContext | ctrl.trackEvent |
| GET | `/api/v1/workspaces/:workspaceId/custom/fields` | backend/src/routes/customFields.routes.js:17 | authenticate / workspaceContext | ctrl.listFields |
| POST | `/api/v1/workspaces/:workspaceId/custom/fields` | backend/src/routes/customFields.routes.js:18 | authenticate / workspaceContext / authorize('CLIENT') | ctrl.createField |
| DELETE | `/api/v1/workspaces/:workspaceId/custom/fields/:id` | backend/src/routes/customFields.routes.js:20 | authenticate / workspaceContext / authorize('CLIENT') | ctrl.deleteField |
| PATCH | `/api/v1/workspaces/:workspaceId/custom/fields/:id` | backend/src/routes/customFields.routes.js:19 | authenticate / workspaceContext / authorize('CLIENT') | ctrl.updateField |
| GET | `/api/v1/workspaces/:workspaceId/deals/` | backend/src/routes/deals.routes.js:13 | authenticate / workspaceContext | dealsController.list |
| POST | `/api/v1/workspaces/:workspaceId/deals/` | backend/src/routes/deals.routes.js:14 | authenticate / workspaceContext / authorize('CLIENT') / validate({ body: dealSchemas.create }) | dealsController.create |
| DELETE | `/api/v1/workspaces/:workspaceId/deals/:id` | backend/src/routes/deals.routes.js:18 | authenticate / workspaceContext / authorize('CLIENT') | dealsController.remove |
| GET | `/api/v1/workspaces/:workspaceId/deals/:id` | backend/src/routes/deals.routes.js:15 | authenticate / workspaceContext | dealsController.get |
| PATCH | `/api/v1/workspaces/:workspaceId/deals/:id` | backend/src/routes/deals.routes.js:16 | authenticate / workspaceContext / authorize('CLIENT') / validate({ body: dealSchemas.update }) | dealsController.update |
| GET | `/api/v1/workspaces/:workspaceId/deals/:id/line-items` | backend/src/routes/deals.routes.js:22 | authenticate / workspaceContext | dealLineItemsController.list |
| POST | `/api/v1/workspaces/:workspaceId/deals/:id/line-items` | backend/src/routes/deals.routes.js:23 | authenticate / workspaceContext / authorize('CLIENT') / validate({ body: dealSchemas.lineItem }) | dealLineItemsController.create |
| DELETE | `/api/v1/workspaces/:workspaceId/deals/:id/line-items/:lineId` | backend/src/routes/deals.routes.js:25 | authenticate / workspaceContext / authorize('CLIENT') | dealLineItemsController.remove |
| PATCH | `/api/v1/workspaces/:workspaceId/deals/:id/line-items/:lineId` | backend/src/routes/deals.routes.js:24 | authenticate / workspaceContext / authorize('CLIENT') / validate({ body: dealSchemas.lineItemUpdate }) | dealLineItemsController.update |
| PATCH | `/api/v1/workspaces/:workspaceId/deals/:id/stage` | backend/src/routes/deals.routes.js:17 | authenticate / workspaceContext / authorize('CLIENT') / validate({ body: dealSchemas.stageUpdate }) | dealsController.updateStage |
| GET | `/api/v1/workspaces/:workspaceId/forecast/` | backend/src/routes/forecast.routes.js:10 | authenticate / workspaceContext | forecastController.get |
| GET | `/api/v1/workspaces/:workspaceId/insights/recommendations` | backend/src/routes/insights.routes.js:11 | authenticate / workspaceContext | insightsController.recommendations |
| GET | `/api/v1/workspaces/:workspaceId/insights/relationship/:contactId` | backend/src/routes/insights.routes.js:12 | authenticate / workspaceContext | insightsController.relationship |
| POST | `/api/v1/workspaces/:workspaceId/instagram/auth-url` | backend/src/routes/instagram.routes.js:15 | authenticate / workspaceContext / requireFeature('automation') | ctrl.authUrl |
| DELETE | `/api/v1/workspaces/:workspaceId/instagram/connection` | backend/src/routes/instagram.routes.js:16 | authenticate / workspaceContext / requireFeature('automation') | ctrl.disconnect |
| GET | `/api/v1/workspaces/:workspaceId/instagram/connection` | backend/src/routes/instagram.routes.js:14 | authenticate / workspaceContext / requireFeature('automation') | ctrl.connection |
| GET | `/api/v1/workspaces/:workspaceId/instagram/flows` | backend/src/routes/instagram.routes.js:18 | authenticate / workspaceContext / requireFeature('automation') | ctrl.listFlows |
| POST | `/api/v1/workspaces/:workspaceId/instagram/flows` | backend/src/routes/instagram.routes.js:19 | authenticate / workspaceContext / requireFeature('automation') / authorize('CLIENT') / validate({ body: instagramSchemas.create }) | ctrl.createFlow |
| DELETE | `/api/v1/workspaces/:workspaceId/instagram/flows/:id` | backend/src/routes/instagram.routes.js:21 | authenticate / workspaceContext / requireFeature('automation') / authorize('CLIENT') | ctrl.deleteFlow |
| PATCH | `/api/v1/workspaces/:workspaceId/instagram/flows/:id` | backend/src/routes/instagram.routes.js:20 | authenticate / workspaceContext / requireFeature('automation') / authorize('CLIENT') / validate({ body: instagramSchemas.update }) | ctrl.updateFlow |
| GET | `/api/v1/workspaces/:workspaceId/integrations/` | backend/src/routes/integrations.routes.js:13 | authenticate / workspaceContext | controller.list |
| DELETE | `/api/v1/workspaces/:workspaceId/integrations/:provider` | backend/src/routes/integrations.routes.js:17 | authenticate / workspaceContext | controller.disconnect |
| POST | `/api/v1/workspaces/:workspaceId/integrations/:provider` | backend/src/routes/integrations.routes.js:16 | authenticate / workspaceContext | controller.connect |
| GET | `/api/v1/workspaces/:workspaceId/integrations/:provider/callback` | backend/src/routes/integrations.routes.js:25 |  | controller.oauthCallback |
| POST | `/api/v1/workspaces/:workspaceId/integrations/oauth/:provider/start` | backend/src/routes/integrations.routes.js:15 | authenticate / workspaceContext | controller.oauthStart |
| GET | `/api/v1/workspaces/:workspaceId/integrations/oauth/providers` | backend/src/routes/integrations.routes.js:14 | authenticate / workspaceContext | controller.oauthProviders |
| GET | `/api/v1/workspaces/:workspaceId/intents/` | backend/src/routes/intent.routes.js:15 | authenticate / workspaceContext | intentController.list |
| POST | `/api/v1/workspaces/:workspaceId/intents/` | backend/src/routes/intent.routes.js:19 | authenticate / workspaceContext / authorize('CLIENT') | intentController.create |
| DELETE | `/api/v1/workspaces/:workspaceId/intents/:id` | backend/src/routes/intent.routes.js:21 | authenticate / workspaceContext / authorize('CLIENT') | intentController.remove |
| PATCH | `/api/v1/workspaces/:workspaceId/intents/:id` | backend/src/routes/intent.routes.js:20 | authenticate / workspaceContext / authorize('CLIENT') | intentController.update |
| GET | `/api/v1/workspaces/:workspaceId/intents/accuracy` | backend/src/routes/intent.routes.js:16 | authenticate / workspaceContext | intentController.accuracy |
| POST | `/api/v1/workspaces/:workspaceId/intents/test` | backend/src/routes/intent.routes.js:17 | authenticate / workspaceContext | intentController.test |
| GET | `/api/v1/workspaces/:workspaceId/invitations/` | backend/src/routes/invitations.routes.js:24 | authenticate / workspaceContext | controller.list |
| POST | `/api/v1/workspaces/:workspaceId/invitations/` | backend/src/routes/invitations.routes.js:21 | authenticate / workspaceContext / inviteLimiter / authorize('ADMIN') / validate({ body: invitationSchemas.create }) | controller.create |
| DELETE | `/api/v1/workspaces/:workspaceId/invitations/:id` | backend/src/routes/invitations.routes.js:26 | authenticate / workspaceContext / authorize('ADMIN') | controller.revoke |
| POST | `/api/v1/workspaces/:workspaceId/invitations/:id/resend` | backend/src/routes/invitations.routes.js:25 | authenticate / workspaceContext / inviteLimiter / authorize('ADMIN') | controller.resend |
| GET | `/api/v1/workspaces/:workspaceId/invitations/:token` | backend/src/routes/invitations.routes.js:35 | tokenLimiter | controller.getByToken |
| POST | `/api/v1/workspaces/:workspaceId/invitations/:token/accept` | backend/src/routes/invitations.routes.js:36 | tokenLimiter / authenticate | controller.accept |
| POST | `/api/v1/workspaces/:workspaceId/invitations/link` | backend/src/routes/invitations.routes.js:23 | authenticate / workspaceContext / inviteLimiter / authorize('ADMIN') / validate({ body: invitationSchemas.createLink }) | controller.createLink |
| POST | `/api/v1/workspaces/:workspaceId/lead-distribution/distribute` | backend/src/routes/leadDistribution.routes.js:13 | authenticate / workspaceContext / authorize('CLIENT') | leadDistributionController.distributeLeads |
| GET | `/api/v1/workspaces/:workspaceId/lead-distribution/rules` | backend/src/routes/leadDistribution.routes.js:11 | authenticate / workspaceContext | leadDistributionController.getRules |
| POST | `/api/v1/workspaces/:workspaceId/lead-distribution/rules` | backend/src/routes/leadDistribution.routes.js:12 | authenticate / workspaceContext / authorize('CLIENT') | leadDistributionController.updateRules |
| GET | `/api/v1/workspaces/:workspaceId/lead-forms/` | backend/src/routes/leadForms.routes.js:11 | authenticate / workspaceContext | formsController.list |
| POST | `/api/v1/workspaces/:workspaceId/lead-forms/` | backend/src/routes/leadForms.routes.js:13 | authenticate / workspaceContext / authorize('CLIENT') / validate({ body: leadFormSchemas.create }) | formsController.create |
| DELETE | `/api/v1/workspaces/:workspaceId/lead-forms/:id` | backend/src/routes/leadForms.routes.js:15 | authenticate / workspaceContext / authorize('CLIENT') | formsController.remove |
| GET | `/api/v1/workspaces/:workspaceId/lead-forms/:id` | backend/src/routes/leadForms.routes.js:12 | authenticate / workspaceContext | formsController.get |
| PATCH | `/api/v1/workspaces/:workspaceId/lead-forms/:id` | backend/src/routes/leadForms.routes.js:14 | authenticate / workspaceContext / authorize('CLIENT') / validate({ body: leadFormSchemas.update }) | formsController.update |
| GET | `/api/v1/workspaces/:workspaceId/leads/` | backend/src/routes/leads.routes.js:12 | authenticate / workspaceContext | leadsController.list |
| POST | `/api/v1/workspaces/:workspaceId/leads/` | backend/src/routes/leads.routes.js:13 | authenticate / workspaceContext / authorize('CLIENT') / validate({ body: leadSchemas.create }) | leadsController.create |
| DELETE | `/api/v1/workspaces/:workspaceId/leads/:id` | backend/src/routes/leads.routes.js:16 | authenticate / workspaceContext / authorize('CLIENT') | leadsController.remove |
| GET | `/api/v1/workspaces/:workspaceId/leads/:id` | backend/src/routes/leads.routes.js:14 | authenticate / workspaceContext | leadsController.get |
| PATCH | `/api/v1/workspaces/:workspaceId/leads/:id` | backend/src/routes/leads.routes.js:15 | authenticate / workspaceContext / authorize('CLIENT') / validate({ body: leadSchemas.update }) | leadsController.update |
| POST | `/api/v1/workspaces/:workspaceId/leads/:id/convert` | backend/src/routes/leads.routes.js:23 | authenticate / workspaceContext / authorize('CLIENT') / validate({ body: leadSchemas.convert }) | leadsController.convert |
| POST | `/api/v1/workspaces/:workspaceId/leads/:id/recalculate-score` | backend/src/routes/leads.routes.js:22 | authenticate / workspaceContext / authorize('CLIENT') | leadsController.recalculateScore |
| POST | `/api/v1/workspaces/:workspaceId/leads/bulk-assign` | backend/src/routes/leads.routes.js:18 | authenticate / workspaceContext / authorize('CLIENT') | leadsController.bulkAssign |
| POST | `/api/v1/workspaces/:workspaceId/leads/bulk-category` | backend/src/routes/leads.routes.js:20 | authenticate / workspaceContext / authorize('CLIENT') | leadsController.bulkCategory |
| POST | `/api/v1/workspaces/:workspaceId/leads/bulk-delete` | backend/src/routes/leads.routes.js:17 | authenticate / workspaceContext / authorize('CLIENT') | leadsController.bulkRemove |
| POST | `/api/v1/workspaces/:workspaceId/leads/bulk-status` | backend/src/routes/leads.routes.js:19 | authenticate / workspaceContext / authorize('CLIENT') | leadsController.bulkStatus |
| POST | `/api/v1/workspaces/:workspaceId/leads/bulk-task` | backend/src/routes/leads.routes.js:21 | authenticate / workspaceContext / authorize('CLIENT') | leadsController.bulkTask |
| GET | `/api/v1/workspaces/:workspaceId/members/` | backend/src/routes/members.routes.js:12 | authenticate / workspaceContext | membersController.list |
| DELETE | `/api/v1/workspaces/:workspaceId/members/:userId` | backend/src/routes/members.routes.js:15 | authenticate / workspaceContext / authorize('ADMIN') | membersController.remove |
| PATCH | `/api/v1/workspaces/:workspaceId/members/:userId` | backend/src/routes/members.routes.js:14 | authenticate / workspaceContext / authorize('ADMIN') / validate({ body: memberSchemas.updateRole }) | membersController.updateRole |
| POST | `/api/v1/workspaces/:workspaceId/members/invite` | backend/src/routes/members.routes.js:13 | authenticate / workspaceContext / authorize('ADMIN') / validate({ body: memberSchemas.invite }) | membersController.invite |
| GET | `/api/v1/workspaces/:workspaceId/opt-outs/` | backend/src/routes/optout.routes.js:13 | authenticate / workspaceContext | optOutController.list |
| POST | `/api/v1/workspaces/:workspaceId/opt-outs/` | backend/src/routes/optout.routes.js:16 | authenticate / workspaceContext / validate({ body: optOutSchemas.block }) | optOutController.block |
| DELETE | `/api/v1/workspaces/:workspaceId/opt-outs/:id` | backend/src/routes/optout.routes.js:18 | authenticate / workspaceContext | optOutController.unblock |
| GET | `/api/v1/workspaces/:workspaceId/opt-outs/export` | backend/src/routes/optout.routes.js:15 | authenticate / workspaceContext | optOutController.exportCsv |
| GET | `/api/v1/workspaces/:workspaceId/opt-outs/keywords` | backend/src/routes/optout.routes.js:14 | authenticate / workspaceContext | optOutController.keywords |
| POST | `/api/v1/workspaces/:workspaceId/opt-outs/unblock` | backend/src/routes/optout.routes.js:17 | authenticate / workspaceContext / validate({ body: optOutSchemas.bulkUnblock }) | optOutController.unblock |
| GET | `/api/v1/workspaces/:workspaceId/pipeline-stages/` | backend/src/routes/pipelineStages.routes.js:12 | authenticate / workspaceContext | stagesController.list |
| PATCH | `/api/v1/workspaces/:workspaceId/pipeline-stages/:key` | backend/src/routes/pipelineStages.routes.js:16 | authenticate / workspaceContext / authorize('ADMIN') / validate({ body: pipelineStageSchemas.update }) | stagesController.update |
| PATCH | `/api/v1/workspaces/:workspaceId/pipeline-stages/reorder` | backend/src/routes/pipelineStages.routes.js:15 | authenticate / workspaceContext / authorize('ADMIN') / validate({ body: pipelineStageSchemas.reorder }) | stagesController.reorder |
| GET | `/api/v1/workspaces/:workspaceId/products/` | backend/src/routes/products.routes.js:11 | authenticate / workspaceContext | productsController.list |
| POST | `/api/v1/workspaces/:workspaceId/products/` | backend/src/routes/products.routes.js:13 | authenticate / workspaceContext / authorize('CLIENT') / validate({ body: productSchemas.create }) | productsController.create |
| DELETE | `/api/v1/workspaces/:workspaceId/products/:id` | backend/src/routes/products.routes.js:15 | authenticate / workspaceContext / authorize('CLIENT') | productsController.remove |
| GET | `/api/v1/workspaces/:workspaceId/products/:id` | backend/src/routes/products.routes.js:12 | authenticate / workspaceContext | productsController.get |
| PATCH | `/api/v1/workspaces/:workspaceId/products/:id` | backend/src/routes/products.routes.js:14 | authenticate / workspaceContext / authorize('CLIENT') / validate({ body: productSchemas.update }) | productsController.update |
| GET | `/api/v1/workspaces/:workspaceId/progress/leaderboard` | backend/src/routes/gamification.routes.js:14 | authenticate / workspaceContext | controller.leaderboard |
| GET | `/api/v1/workspaces/:workspaceId/progress/me` | backend/src/routes/gamification.routes.js:11 | authenticate / workspaceContext | controller.profile |
| GET | `/api/v1/workspaces/:workspaceId/quotes/` | backend/src/routes/quotes.routes.js:11 | authenticate / workspaceContext | quotesController.list |
| POST | `/api/v1/workspaces/:workspaceId/quotes/` | backend/src/routes/quotes.routes.js:13 | authenticate / workspaceContext / authorize('CLIENT') / validate({ body: quoteSchemas.create }) | quotesController.create |
| DELETE | `/api/v1/workspaces/:workspaceId/quotes/:id` | backend/src/routes/quotes.routes.js:16 | authenticate / workspaceContext / authorize('CLIENT') | quotesController.remove |
| GET | `/api/v1/workspaces/:workspaceId/quotes/:id` | backend/src/routes/quotes.routes.js:12 | authenticate / workspaceContext | quotesController.get |
| PATCH | `/api/v1/workspaces/:workspaceId/quotes/:id` | backend/src/routes/quotes.routes.js:14 | authenticate / workspaceContext / authorize('CLIENT') / validate({ body: quoteSchemas.update }) | quotesController.update |
| POST | `/api/v1/workspaces/:workspaceId/quotes/:id/line-items` | backend/src/routes/quotes.routes.js:17 | authenticate / workspaceContext / authorize('CLIENT') / validate({ body: quoteSchemas.lineItem }) | quotesController.addLine |
| DELETE | `/api/v1/workspaces/:workspaceId/quotes/:id/line-items/:lineId` | backend/src/routes/quotes.routes.js:18 | authenticate / workspaceContext / authorize('CLIENT') | quotesController.removeLine |
| PATCH | `/api/v1/workspaces/:workspaceId/quotes/:id/status` | backend/src/routes/quotes.routes.js:15 | authenticate / workspaceContext / authorize('CLIENT') / validate({ body: quoteSchemas.status }) | quotesController.changeStatus |
| GET | `/api/v1/workspaces/:workspaceId/saved-views/` | backend/src/routes/savedViews.routes.js:12 | authenticate / workspaceContext | savedViewsController.list |
| POST | `/api/v1/workspaces/:workspaceId/saved-views/` | backend/src/routes/savedViews.routes.js:13 | authenticate / workspaceContext / authorize('CLIENT') / validate({ body: savedViewSchemas.create }) | savedViewsController.create |
| DELETE | `/api/v1/workspaces/:workspaceId/saved-views/:id` | backend/src/routes/savedViews.routes.js:15 | authenticate / workspaceContext / authorize('CLIENT') | savedViewsController.remove |
| PATCH | `/api/v1/workspaces/:workspaceId/saved-views/:id` | backend/src/routes/savedViews.routes.js:14 | authenticate / workspaceContext / authorize('CLIENT') / validate({ body: savedViewSchemas.update }) | savedViewsController.update |
| GET | `/api/v1/workspaces/:workspaceId/search/` | backend/src/routes/search.routes.js:10 | authenticate / workspaceContext | searchController.search |
| GET | `/api/v1/workspaces/:workspaceId/segments/` | backend/src/routes/segments.routes.js:14 | authenticate / workspaceContext | segmentsController.listSegments |
| POST | `/api/v1/workspaces/:workspaceId/segments/` | backend/src/routes/segments.routes.js:15 | authenticate / workspaceContext / validate({ body: segmentSchemas.create }) | segmentsController.createSegment |
| DELETE | `/api/v1/workspaces/:workspaceId/segments/:id` | backend/src/routes/segments.routes.js:17 | authenticate / workspaceContext | segmentsController.deleteSegment |
| PATCH | `/api/v1/workspaces/:workspaceId/segments/:id` | backend/src/routes/segments.routes.js:16 | authenticate / workspaceContext / validate({ body: segmentSchemas.update }) | segmentsController.updateSegment |
| POST | `/api/v1/workspaces/:workspaceId/segments/:id/contacts` | backend/src/routes/segments.routes.js:20 | authenticate / workspaceContext | segmentsController.addContactToSegment |
| DELETE | `/api/v1/workspaces/:workspaceId/segments/:id/contacts/:contactId` | backend/src/routes/segments.routes.js:22 | authenticate / workspaceContext | segmentsController.removeContactFromSegment |
| PATCH | `/api/v1/workspaces/:workspaceId/segments/:id/contacts/:contactId` | backend/src/routes/segments.routes.js:21 | authenticate / workspaceContext / validate({ body: contactSchemas.update }) | segmentsController.updateContactInSegment |
| GET | `/api/v1/workspaces/:workspaceId/sequences/` | backend/src/routes/sequences.routes.js:11 | authenticate / workspaceContext | sequencesController.list |
| POST | `/api/v1/workspaces/:workspaceId/sequences/` | backend/src/routes/sequences.routes.js:13 | authenticate / workspaceContext / authorize('CLIENT') / validate({ body: sequenceSchemas.create }) | sequencesController.create |
| DELETE | `/api/v1/workspaces/:workspaceId/sequences/:id` | backend/src/routes/sequences.routes.js:16 | authenticate / workspaceContext / authorize('CLIENT') | sequencesController.remove |
| GET | `/api/v1/workspaces/:workspaceId/sequences/:id` | backend/src/routes/sequences.routes.js:12 | authenticate / workspaceContext | sequencesController.get |
| PATCH | `/api/v1/workspaces/:workspaceId/sequences/:id` | backend/src/routes/sequences.routes.js:14 | authenticate / workspaceContext / authorize('CLIENT') / validate({ body: sequenceSchemas.update }) | sequencesController.update |
| POST | `/api/v1/workspaces/:workspaceId/sequences/:id/enroll` | backend/src/routes/sequences.routes.js:17 | authenticate / workspaceContext / authorize('CLIENT') / validate({ body: sequenceSchemas.enroll }) | sequencesController.enroll |
| DELETE | `/api/v1/workspaces/:workspaceId/sequences/:id/enrollments/:enrollmentId` | backend/src/routes/sequences.routes.js:18 | authenticate / workspaceContext / authorize('CLIENT') | sequencesController.unenroll |
| PATCH | `/api/v1/workspaces/:workspaceId/sequences/:id/status` | backend/src/routes/sequences.routes.js:15 | authenticate / workspaceContext / authorize('CLIENT') / validate({ body: sequenceSchemas.status }) | sequencesController.changeStatus |
| GET | `/api/v1/workspaces/:workspaceId/settings/` | backend/src/routes/settings.routes.js:11 | authenticate / workspaceContext | settingsController.getSettings |
| PATCH | `/api/v1/workspaces/:workspaceId/settings/` | backend/src/routes/settings.routes.js:12 | authenticate / workspaceContext / validate({ body: settingsSchemas.update }) | settingsController.updateSettings |
| GET | `/api/v1/workspaces/:workspaceId/settings/invoices` | backend/src/routes/settings.routes.js:13 | authenticate / workspaceContext | settingsController.getInvoices |
| GET | `/api/v1/workspaces/:workspaceId/settings/invoices/:invoiceId/download` | backend/src/routes/settings.routes.js:14 | authenticate / workspaceContext | settingsController.downloadInvoice |
| POST | `/api/v1/workspaces/:workspaceId/settings/webhook/test` | backend/src/routes/settings.routes.js:15 | authenticate / workspaceContext | settingsController.testWebhook |
| GET | `/api/v1/workspaces/:workspaceId/subscription/` | backend/src/routes/subscription.routes.js:10 | authenticate / workspaceContext | controller.getSummary |
| GET | `/api/v1/workspaces/:workspaceId/subscription/addons` | backend/src/routes/subscription.routes.js:21 | authenticate / workspaceContext | controller.listAddons |
| DELETE | `/api/v1/workspaces/:workspaceId/subscription/addons/:addonKey` | backend/src/routes/subscription.routes.js:24 | authenticate / workspaceContext / authorize('ADMIN') | controller.cancelAddon |
| POST | `/api/v1/workspaces/:workspaceId/subscription/addons/checkout` | backend/src/routes/subscription.routes.js:22 | authenticate / workspaceContext / authorize('ADMIN') | controller.createAddonCheckout |
| POST | `/api/v1/workspaces/:workspaceId/subscription/addons/checkout/verify` | backend/src/routes/subscription.routes.js:23 | authenticate / workspaceContext / authorize('ADMIN') | controller.verifyAddonCheckout |
| POST | `/api/v1/workspaces/:workspaceId/subscription/checkout` | backend/src/routes/subscription.routes.js:15 | authenticate / workspaceContext / authorize('ADMIN') | controller.createCheckout |
| POST | `/api/v1/workspaces/:workspaceId/subscription/checkout/verify` | backend/src/routes/subscription.routes.js:16 | authenticate / workspaceContext / authorize('ADMIN') | controller.verifyCheckout |
| GET | `/api/v1/workspaces/:workspaceId/subscription/plans` | backend/src/routes/subscription.routes.js:11 | authenticate / workspaceContext | controller.getPlans |
| GET | `/api/v1/workspaces/:workspaceId/subscription/pricing` | backend/src/routes/subscription.routes.js:12 | authenticate / workspaceContext | controller.getMessagePricing |
| GET | `/api/v1/workspaces/:workspaceId/support/` | backend/src/routes/support.routes.js:9 | authenticate / workspaceContext | controller.list |
| POST | `/api/v1/workspaces/:workspaceId/support/` | backend/src/routes/support.routes.js:10 | authenticate / workspaceContext | controller.create |
| POST | `/api/v1/workspaces/:workspaceId/switch/` | backend/src/routes/workspaceSwitch.routes.js:12 | authenticate / workspaceContext | async (req, res) => { const result = await authService.switchWorkspace(req.user. |
| GET | `/api/v1/workspaces/:workspaceId/tasks/` | backend/src/routes/tasks.routes.js:12 | authenticate / workspaceContext | tasksController.list |
| POST | `/api/v1/workspaces/:workspaceId/tasks/` | backend/src/routes/tasks.routes.js:13 | authenticate / workspaceContext / authorize('CLIENT') / validate({ body: taskSchemas.create }) | tasksController.create |
| DELETE | `/api/v1/workspaces/:workspaceId/tasks/:id` | backend/src/routes/tasks.routes.js:16 | authenticate / workspaceContext / authorize('CLIENT') | tasksController.remove |
| GET | `/api/v1/workspaces/:workspaceId/tasks/:id` | backend/src/routes/tasks.routes.js:14 | authenticate / workspaceContext | tasksController.get |
| PATCH | `/api/v1/workspaces/:workspaceId/tasks/:id` | backend/src/routes/tasks.routes.js:15 | authenticate / workspaceContext / authorize('CLIENT') / validate({ body: taskSchemas.update }) | tasksController.update |
| GET | `/api/v1/workspaces/:workspaceId/teams/` | backend/src/routes/teams.routes.js:15 | authenticate / workspaceContext | teamsController.list |
| POST | `/api/v1/workspaces/:workspaceId/teams/` | backend/src/routes/teams.routes.js:17 | authenticate / workspaceContext / authorize('ADMIN') / validate({ body: teamSchemas.create }) | teamsController.create |
| DELETE | `/api/v1/workspaces/:workspaceId/teams/:id` | backend/src/routes/teams.routes.js:21 | authenticate / workspaceContext / authorize('ADMIN') | teamsController.remove |
| PATCH | `/api/v1/workspaces/:workspaceId/teams/:id` | backend/src/routes/teams.routes.js:19 | authenticate / workspaceContext / authorize('ADMIN') / validate({ body: teamSchemas.update }) | teamsController.update |
| PUT | `/api/v1/workspaces/:workspaceId/teams/:id/members` | backend/src/routes/teams.routes.js:20 | authenticate / workspaceContext / authorize('ADMIN') / validate({ body: teamSchemas.members }) | teamsController.setMembers |
| GET | `/api/v1/workspaces/:workspaceId/teams/visibility` | backend/src/routes/teams.routes.js:16 | authenticate / workspaceContext | teamsController.getVisibility |
| PATCH | `/api/v1/workspaces/:workspaceId/teams/visibility` | backend/src/routes/teams.routes.js:18 | authenticate / workspaceContext / authorize('ADMIN') / validate({ body: teamSchemas.visibility }) | teamsController.setVisibility |
| GET | `/api/v1/workspaces/:workspaceId/templates/` | backend/src/routes/templates.routes.js:19 | authenticate / workspaceContext | templatesController.list |
| POST | `/api/v1/workspaces/:workspaceId/templates/` | backend/src/routes/templates.routes.js:20 | authenticate / workspaceContext / validate({ body: templateSchemas.create }) | templatesController.create |
| DELETE | `/api/v1/workspaces/:workspaceId/templates/:id` | backend/src/routes/templates.routes.js:34 | authenticate / workspaceContext | templatesController.remove |
| GET | `/api/v1/workspaces/:workspaceId/templates/:id` | backend/src/routes/templates.routes.js:32 | authenticate / workspaceContext | templatesController.getOne |
| PUT | `/api/v1/workspaces/:workspaceId/templates/:id` | backend/src/routes/templates.routes.js:33 | authenticate / workspaceContext / validate({ body: templateSchemas.update }) | templatesController.update |
| POST | `/api/v1/workspaces/:workspaceId/templates/:id/duplicate` | backend/src/routes/templates.routes.js:35 | authenticate / workspaceContext | templatesController.duplicate |
| POST | `/api/v1/workspaces/:workspaceId/templates/:id/restore` | backend/src/routes/templates.routes.js:36 | authenticate / workspaceContext | templatesController.restore |
| POST | `/api/v1/workspaces/:workspaceId/templates/:id/utility-variant` | backend/src/routes/templates.routes.js:37 | authenticate / workspaceContext | templatesController.utilityVariant |
| POST | `/api/v1/workspaces/:workspaceId/templates/ai/draft` | backend/src/routes/templates.routes.js:27 | authenticate / workspaceContext | templatesController.aiDraft |
| POST | `/api/v1/workspaces/:workspaceId/templates/ai/image` | backend/src/routes/templates.routes.js:28 | authenticate / workspaceContext | templatesController.aiImage |
| GET | `/api/v1/workspaces/:workspaceId/templates/ai/suggestions` | backend/src/routes/templates.routes.js:26 | authenticate / workspaceContext | templatesController.aiSuggestions |
| GET | `/api/v1/workspaces/:workspaceId/templates/library` | backend/src/routes/templates.routes.js:30 | authenticate / workspaceContext | templatesController.library |
| POST | `/api/v1/workspaces/:workspaceId/templates/library/:libId/install` | backend/src/routes/templates.routes.js:31 | authenticate / workspaceContext | templatesController.installLibrary |
| POST | `/api/v1/workspaces/:workspaceId/templates/media` | backend/src/routes/templates.routes.js:24 | authenticate / workspaceContext / upload.single('file') / verifyFileContents | templatesController.uploadMedia |
| GET | `/api/v1/workspaces/:workspaceId/templates/media/:assetId` | backend/src/routes/templates.routes.js:25 | authenticate / workspaceContext | templatesController.headerImage |
| POST | `/api/v1/workspaces/:workspaceId/templates/sync-from-meta` | backend/src/routes/templates.routes.js:29 | authenticate / workspaceContext | templatesController.syncFromMeta |
| GET | `/api/v1/workspaces/:workspaceId/tickets/` | backend/src/routes/tickets.routes.js:12 | authenticate / workspaceContext | ticketsController.list |
| POST | `/api/v1/workspaces/:workspaceId/tickets/` | backend/src/routes/tickets.routes.js:15 | authenticate / workspaceContext / authorize('CLIENT') / validate({ body: ticketSchemas.create }) | ticketsController.create |
| DELETE | `/api/v1/workspaces/:workspaceId/tickets/:id` | backend/src/routes/tickets.routes.js:18 | authenticate / workspaceContext / authorize('CLIENT') | ticketsController.remove |
| GET | `/api/v1/workspaces/:workspaceId/tickets/:id` | backend/src/routes/tickets.routes.js:14 | authenticate / workspaceContext | ticketsController.get |
| PATCH | `/api/v1/workspaces/:workspaceId/tickets/:id` | backend/src/routes/tickets.routes.js:16 | authenticate / workspaceContext / authorize('CLIENT') / validate({ body: ticketSchemas.update }) | ticketsController.update |
| PATCH | `/api/v1/workspaces/:workspaceId/tickets/:id/status` | backend/src/routes/tickets.routes.js:17 | authenticate / workspaceContext / authorize('CLIENT') / validate({ body: ticketSchemas.status }) | ticketsController.changeStatus |
| GET | `/api/v1/workspaces/:workspaceId/tickets/counts` | backend/src/routes/tickets.routes.js:13 | authenticate / workspaceContext | ticketsController.counts |
| GET | `/api/v1/workspaces/:workspaceId/wallet/` | backend/src/routes/wallet.routes.js:10 | authenticate / workspaceContext | walletController.getWallet |
| POST | `/api/v1/workspaces/:workspaceId/wallet/checkout` | backend/src/routes/wallet.routes.js:13 | authenticate / workspaceContext / authorize('ADMIN') | walletController.createCheckout |
| POST | `/api/v1/workspaces/:workspaceId/wallet/checkout/verify` | backend/src/routes/wallet.routes.js:14 | authenticate / workspaceContext / authorize('ADMIN') | walletController.verifyCheckout |
| POST | `/api/v1/workspaces/:workspaceId/wallet/recharge` | backend/src/routes/wallet.routes.js:12 | authenticate / workspaceContext / authorize('ADMIN') | walletController.recharge |
| GET | `/api/v1/workspaces/:workspaceId/wallet/summary` | backend/src/routes/wallet.routes.js:11 | authenticate / workspaceContext | walletController.getSummary |
| GET | `/api/v1/workspaces/:workspaceId/whatsapp-forms/` | backend/src/routes/whatsappForms.routes.js:14 | authenticate / workspaceContext | whatsappFormsController.listForms |
| POST | `/api/v1/workspaces/:workspaceId/whatsapp-forms/` | backend/src/routes/whatsappForms.routes.js:16 | authenticate / workspaceContext / validate({ body: whatsappFormSchemas.create }) | whatsappFormsController.createForm |
| DELETE | `/api/v1/workspaces/:workspaceId/whatsapp-forms/:id` | backend/src/routes/whatsappForms.routes.js:18 | authenticate / workspaceContext | whatsappFormsController.deleteForm |
| PATCH | `/api/v1/workspaces/:workspaceId/whatsapp-forms/:id` | backend/src/routes/whatsappForms.routes.js:17 | authenticate / workspaceContext / validate({ body: whatsappFormSchemas.update }) | whatsappFormsController.updateForm |
| GET | `/api/v1/workspaces/:workspaceId/whatsapp-forms/:id/submissions` | backend/src/routes/whatsappForms.routes.js:15 | authenticate / workspaceContext | whatsappFormsController.listSubmissions |
| GET | `/api/v1/workspaces/:workspaceId/whatsapp-forms/templates` | backend/src/routes/whatsappForms.routes.js:13 | authenticate / workspaceContext | whatsappFormsController.listTemplates |
| POST | `/api/v1/workspaces/:workspaceId/whatsapp/embedded-signup` | backend/src/routes/whatsapp.routes.js:17 | authenticate / workspaceContext | whatsappController.completeEmbeddedSignup |
| GET | `/api/v1/workspaces/:workspaceId/whatsapp/embedded-signup/config` | backend/src/routes/whatsapp.routes.js:16 | authenticate / workspaceContext | whatsappController.embeddedSignupConfig |
| GET | `/api/v1/workspaces/:workspaceId/whatsapp/numbers` | backend/src/routes/whatsapp.routes.js:11 | authenticate / workspaceContext | whatsappController.listNumbers |
| DELETE | `/api/v1/workspaces/:workspaceId/whatsapp/numbers/:id` | backend/src/routes/whatsapp.routes.js:38 | authenticate / workspaceContext | whatsappController.disconnect |
| GET | `/api/v1/workspaces/:workspaceId/whatsapp/numbers/:id/health` | backend/src/routes/whatsapp.routes.js:21 | authenticate / workspaceContext | whatsappController.health |
| POST | `/api/v1/workspaces/:workspaceId/whatsapp/numbers/:id/reconnect` | backend/src/routes/whatsapp.routes.js:24 | authenticate / workspaceContext | whatsappController.reconnect |
| POST | `/api/v1/workspaces/:workspaceId/whatsapp/numbers/:id/request-code` | backend/src/routes/whatsapp.routes.js:27 | authenticate / workspaceContext / rateLimit({ windowMs: 15 * 60_000, max: 5, keyPrefix: 'wa-verify' }) | whatsappController.requestVerification |
| GET | `/api/v1/workspaces/:workspaceId/whatsapp/numbers/:id/subscription` | backend/src/routes/whatsapp.routes.js:18 | authenticate / workspaceContext | whatsappController.checkSubscription |
| POST | `/api/v1/workspaces/:workspaceId/whatsapp/numbers/:id/verify-code` | backend/src/routes/whatsapp.routes.js:30 | authenticate / workspaceContext / rateLimit({ windowMs: 15 * 60_000, max: 10, keyPrefix: 'wa-verify-code' }) | whatsappController.confirmVerification |
| POST | `/api/v1/workspaces/:workspaceId/whatsapp/numbers/connect-own` | backend/src/routes/whatsapp.routes.js:13 | authenticate / workspaceContext | whatsappController.connectOwnNumber |
| GET | `/api/v1/workspaces/:workspaceId/whatsapp/numbers/pool` | backend/src/routes/whatsapp.routes.js:14 | authenticate / workspaceContext | whatsappController.listPool |
| POST | `/api/v1/workspaces/:workspaceId/whatsapp/numbers/refresh` | backend/src/routes/whatsapp.routes.js:12 | authenticate / workspaceContext | whatsappController.refreshNumbers |
| POST | `/api/v1/workspaces/:workspaceId/whatsapp/onboard` | backend/src/routes/whatsapp.routes.js:15 | authenticate / workspaceContext | whatsappController.onboard |
| GET | `/api/v1/workspaces/:workspaceId/widgets/` | backend/src/routes/widgets.routes.js:33 | authenticate / workspaceContext | widgetsController.list |
| POST | `/api/v1/workspaces/:workspaceId/widgets/` | backend/src/routes/widgets.routes.js:34 | authenticate / workspaceContext | widgetsController.create |
| DELETE | `/api/v1/workspaces/:workspaceId/widgets/:id` | backend/src/routes/widgets.routes.js:37 | authenticate / workspaceContext | widgetsController.remove |
| GET | `/api/v1/workspaces/:workspaceId/widgets/:id` | backend/src/routes/widgets.routes.js:35 | authenticate / workspaceContext | widgetsController.getOne |
| PATCH | `/api/v1/workspaces/:workspaceId/widgets/:id` | backend/src/routes/widgets.routes.js:36 | authenticate / workspaceContext | widgetsController.update |
| POST | `/api/v1/workspaces/:workspaceId/widgets/:id/preview` | backend/src/routes/widgets.routes.js:41 | authenticate / workspaceContext / rateLimit({ windowMs: 60_000, max: 20, keyPrefix: 'widget-preview' }) | widgetsController.preview |
| POST | `/api/v1/workspaces/:workspaceId/widgets/:id/rotate-key` | backend/src/routes/widgets.routes.js:38 | authenticate / workspaceContext | widgetsController.rotateKey |
| GET | `/api/v1/workspaces/:workspaceId/widgets/analytics` | backend/src/routes/widgets.routes.js:19 | authenticate / workspaceContext | widgetsController.analytics |
| GET | `/api/v1/workspaces/:workspaceId/widgets/knowledge` | backend/src/routes/widgets.routes.js:24 | authenticate / workspaceContext | widgetsController.listSources |
| POST | `/api/v1/workspaces/:workspaceId/widgets/knowledge` | backend/src/routes/widgets.routes.js:25 | authenticate / workspaceContext | widgetsController.createSource |
| DELETE | `/api/v1/workspaces/:workspaceId/widgets/knowledge/:sourceId` | backend/src/routes/widgets.routes.js:31 | authenticate / workspaceContext | widgetsController.removeSource |
| PATCH | `/api/v1/workspaces/:workspaceId/widgets/knowledge/:sourceId` | backend/src/routes/widgets.routes.js:29 | authenticate / workspaceContext | widgetsController.updateSource |
| POST | `/api/v1/workspaces/:workspaceId/widgets/knowledge/:sourceId/refresh` | backend/src/routes/widgets.routes.js:30 | authenticate / workspaceContext | widgetsController.refreshSource |
| POST | `/api/v1/workspaces/:workspaceId/widgets/knowledge/reindex` | backend/src/routes/widgets.routes.js:28 | authenticate / workspaceContext | widgetsController.reindex |
| GET | `/api/v1/workspaces/:workspaceId/widgets/knowledge/status` | backend/src/routes/widgets.routes.js:27 | authenticate / workspaceContext | widgetsController.knowledgeStatus |
| POST | `/api/v1/workspaces/:workspaceId/widgets/knowledge/upload` | backend/src/routes/widgets.routes.js:26 | authenticate / workspaceContext / upload.single('file') / verifyFileContents | widgetsController.uploadSource |
| GET | `/api/v1/workspaces/:workspaceId/widgets/sessions` | backend/src/routes/widgets.routes.js:20 | authenticate / workspaceContext | widgetsController.sessions |
| GET | `/api/v1/workspaces/:workspaceId/workflows/` | backend/src/routes/workflow.routes.js:13 | authenticate / workspaceContext / requireFeature('workflows') | workflowController.list |
| POST | `/api/v1/workspaces/:workspaceId/workflows/` | backend/src/routes/workflow.routes.js:15 | authenticate / workspaceContext / requireFeature('workflows') / validate({ body: workflowSchemas.create }) | workflowController.create |
| DELETE | `/api/v1/workspaces/:workspaceId/workflows/:id` | backend/src/routes/workflow.routes.js:17 | authenticate / workspaceContext / requireFeature('workflows') | workflowController.remove |
| PATCH | `/api/v1/workspaces/:workspaceId/workflows/:id` | backend/src/routes/workflow.routes.js:16 | authenticate / workspaceContext / requireFeature('workflows') / validate({ body: workflowSchemas.update }) | workflowController.update |
| POST | `/api/v1/workspaces/:workspaceId/workflows/compile` | backend/src/routes/workflow.routes.js:23 | authenticate / workspaceContext / requireFeature('workflows') / validate({ body: workflowCompilerSchemas.compile }) | compilerController.compile |
| GET | `/api/v1/workspaces/:workspaceId/workflows/runs` | backend/src/routes/workflow.routes.js:14 | authenticate / workspaceContext / requireFeature('workflows') | workflowController.runs |
| GET | `/api/v1/workspaces/:workspaceId/workflows/vocabulary` | backend/src/routes/workflow.routes.js:22 | authenticate / workspaceContext / requireFeature('workflows') | compilerController.vocabulary |
| GET | `/api/v1/workspaces/mine` | backend/src/routes/workspaces.routes.js:18 | authenticate | async (req, res) => { res.json(await authService.listMyWorkspaces(req.user.id) |
| POST | `/widget/v1/:key/ask` | backend/src/routes/widgetPublic.routes.js:44 | rateLimit({ windowMs: 60_000, max: 12, keyPrefix: 'widget-ask' }) | controller.ask |
| GET | `/widget/v1/:key/config` | backend/src/routes/widgetPublic.routes.js:38 | rateLimit({ windowMs: 60_000, max: 120, keyPrefix: 'widget-config' }) | controller.config |
| POST | `/widget/v1/:key/event` | backend/src/routes/widgetPublic.routes.js:48 | rateLimit({ windowMs: 60_000, max: 120, keyPrefix: 'widget-event' }) | controller.event |
| POST | `/widget/v1/:key/handoff` | backend/src/routes/widgetPublic.routes.js:46 | rateLimit({ windowMs: 60_000, max: 30, keyPrefix: 'widget-handoff' }) | controller.handoff |
| POST | `/widget/v1/:key/lead` | backend/src/routes/widgetPublic.routes.js:47 | rateLimit({ windowMs: 60_000, max: 10, keyPrefix: 'widget-lead' }) | controller.lead |
| GET | `/widget/v1/loader.js` | backend/src/routes/widgetPublic.routes.js:34 |  | controller.loader |
