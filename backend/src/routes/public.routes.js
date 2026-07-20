import { Router } from 'express';
import { authenticateApiKey } from '../middleware/authenticateApiKey.js';
import * as templatesController from '../controllers/templates.controller.js';
import * as campaignsController from '../controllers/campaigns.controller.js';
import * as contactsController from '../controllers/contacts.controller.js';
import * as settingsController from '../controllers/settings.controller.js';
import * as whatsappService from '../services/whatsapp.service.js';

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
router.post('/messages', async (req, res, next) => {
  try {
    const result = await whatsappService.sendPublicMessage(req.workspaceId, req.body);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

// --- Templates ---
router.get('/templates', injectWorkspace(templatesController.list));
router.post('/templates', injectWorkspace(templatesController.create));
router.get('/templates/:id', injectWorkspace(templatesController.getOne));

// --- Campaigns ---
router.get('/campaigns', injectWorkspace(campaignsController.list));
router.post('/campaigns', injectWorkspace(campaignsController.create));
router.get('/campaigns/:id', injectWorkspace(campaignsController.getOne));
router.post('/campaigns/:id/launch', injectWorkspace(campaignsController.launch));

// --- Contacts ---
router.get('/contacts', injectWorkspace(contactsController.list));
router.post('/contacts', injectWorkspace(contactsController.create));
router.put('/contacts/:id', injectWorkspace(contactsController.update));

// --- Webhooks ---
// Allow customers to register their webhook URL by updating workspace settings
router.post('/webhooks', async (req, res, next) => {
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
