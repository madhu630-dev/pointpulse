const express = require('express');
const router = express.Router();
const allocationController = require('../controllers/allocationController');
const { authenticateToken, requireAdmin } = require('../middleware/authMiddleware');

// Operator Routes (Drag & Drop Allocation)
router.get('/user', authenticateToken, allocationController.getUserAllocationData);
router.post('/user/submit', authenticateToken, allocationController.submitUserAllocation);

// Administrator Routes (Redeem Request Section)
router.get('/admin', authenticateToken, requireAdmin, allocationController.getAdminAllocationView);
router.post('/admin/toggle/:allocationId', authenticateToken, requireAdmin, allocationController.toggleRedemptionStatus);
router.post('/admin/settings/:userId', authenticateToken, requireAdmin, allocationController.saveAdminAllocationSettings);
router.post('/admin/unlock/:userId', authenticateToken, requireAdmin, allocationController.unlockUserBatch);

module.exports = router;
