import { Router } from 'express';
import { authenticateApiKey } from '../middleware/authenticateApiKey.js';
import { requireScope } from '../lib/apiScopes.js';
import * as templatesController from '../controllers/templates.controller.js';
import * as campaignsController from '../controllers/campaigns.controller.js';
import * as contactsController from '../controllers/contacts.controller.js';
import * as settingsController from '../controllers/settings.controller.js';
import * as analyticsController from '../controllers/analytics.controller.js';
import * as walletController from '../controllers/wallet.controller.js';
import * as aiAgentController from '../controllers/aiAgent.controller.js';
import * as automationController from '../controllers/automation.controller.js';
import * as whatsappService from '../services/whatsapp.service.js';
import { validate, templateSchemas, campaignSchemas } from '../validators/index.js';

const router = Router();

// 1. Authenticate all public routes
router.use(authenticateApiKey);

// 2. Inject workspaceId into req.params just before controller executes 
//    to avoid Express wiping req.params when matching route paths.
const injectWorkspace = (fn) => (req, res, next) => {
  req.params.workspaceId = req.workspaceId;
  return fn(req, res, next);
};

// --- Messages ---
router.post('/messages', requireScope('messages:send'), async (req, res, next) => {
  try {
    const result = await whatsappService.sendPublicMessage(req.workspaceId, req.body);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

// --- Templates ---
router.get('/templates', requireScope('templates:read'), injectWorkspace(templatesController.list));
router.post('/templates', requireScope('templates:write'), validate({ body: templateSchemas.create }), injectWorkspace(templatesController.create));
router.get('/templates/:id', requireScope('templates:read'), injectWorkspace(templatesController.getOne));

// --- Campaigns ---
router.get('/campaigns', requireScope('campaigns:read'), injectWorkspace(campaignsController.list));
router.post('/campaigns', requireScope('campaigns:write'), validate({ body: campaignSchemas.create }), injectWorkspace(campaignsController.create));
router.get('/campaigns/:id', requireScope('campaigns:read'), injectWorkspace(campaignsController.getOne));
router.post('/campaigns/:id/recipients', requireScope('campaigns:write'), validate({ body: campaignSchemas.addRecipients }), injectWorkspace(campaignsController.addRecipients));
router.put('/campaigns/:id/recipients', requireScope('campaigns:write'), validate({ body: campaignSchemas.setRecipients }), injectWorkspace(campaignsController.setRecipients));
router.post('/campaigns/:id/launch', requireScope('campaigns:write'), injectWorkspace(campaignsController.launch));

// --- Contacts ---
router.get('/contacts', requireScope('contacts:read'), injectWorkspace(contactsController.list));
router.post('/contacts', requireScope('contacts:write'), injectWorkspace(contactsController.create));
router.put('/contacts/:id', requireScope('contacts:write'), injectWorkspace(contactsController.update));

// --- Analytics ---
router.get('/analytics/summary', requireScope('analytics:read'), injectWorkspace(analyticsController.overview));

// --- Wallet ---
router.get('/wallet/balance', requireScope('wallet:read'), injectWorkspace(walletController.getWallet));

// --- AI Agent ---
router.get('/ai-agent/config', requireScope('ai-agent:read'), injectWorkspace(aiAgentController.getConfig));
router.post('/ai-agent/query', requireScope('ai-agent:write'), injectWorkspace(aiAgentController.test));

// --- Automations ---
router.get('/automations', requireScope('automations:read'), injectWorkspace(automationController.list));

// --- Webhooks ---
// Allow customers to register their webhook URL by updating workspace settings
router.post('/webhooks', requireScope('webhooks:write'), async (req, res, next) => {
  try {
    const { webhookUrl } = req.body;
    if (typeof webhookUrl !== 'string') {
      return res.status(400).json({ error: 'webhookUrl must be a string' });
    }
    
    // Create a mock req object to pass to the settings controller
    const mockReq = { 
      params: { workspaceId: req.workspaceId }, 
      body: { webhookUrl } 
    };
    
    // We can't easily use the controller directly because it calls res.json()
    // but here we just call the controller with the real res.
    await settingsController.updateSettings(mockReq, res);
  } catch (err) {
    next(err);
  }
});

export default router;
