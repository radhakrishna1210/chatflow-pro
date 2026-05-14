import { Router } from 'express';
import * as adminController from '../controllers/admin.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireAdmin } from '../middleware/authorize.js';

const router = Router();

router.use(authenticate, requireAdmin);

// Pool management
router.get('/numbers/pool',             adminController.getPool);
router.post('/numbers/add',             adminController.addNumber);
router.post('/numbers/assign',          adminController.assignToWorkspace);
router.post('/numbers/reset-all',       adminController.resetAllAssignments);
router.patch('/numbers/pool/:id/reset', adminController.resetPoolEntry);
router.patch('/numbers/pool/:id/ban',   adminController.banPoolEntry);

// Workspaces (for admin assignment picker)
router.get('/workspaces',               adminController.listWorkspaces);

// OTP flow (manual)
router.post('/numbers/request-otp',     adminController.requestOtp);
router.post('/numbers/verify-otp',      adminController.verifyOtp);

// Sync pool from Meta WABA (no OTP needed)
router.post('/numbers/sync-from-waba',  adminController.syncPoolFromWaba);

// Twilio auto-sync (OTP via SMS)
router.post('/twilio/sync',             adminController.twilioSync);

// WABA info
router.get('/waba/numbers',             adminController.getWabaNumbers);

// Meta app review test calls
router.post('/meta/test-calls',         adminController.metaTestCalls);

export default router;
