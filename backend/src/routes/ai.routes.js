import { Router } from 'express';
import { createTemplate, createCampaign, updateCampaign, updateTemplate, executeWorkflow } from '../controllers/ai.controller.js';
import { authenticate } from '../middleware/authenticate.js';

const router = Router();

router.use(authenticate);

router.post('/template/create', createTemplate);
router.post('/campaign/create', createCampaign);
router.post('/campaign/update', updateCampaign);
router.post('/template/update', updateTemplate);
router.post('/workflow/execute', executeWorkflow);

export default router;
