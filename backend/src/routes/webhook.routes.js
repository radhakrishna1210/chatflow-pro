import { Router } from 'express';
import * as webhookController from '../controllers/webhook.controller.js';

const router = Router();

router.get('/meta', webhookController.verify);
router.post('/meta', webhookController.receive);

export default router;
