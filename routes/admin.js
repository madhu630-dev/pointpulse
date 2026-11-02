const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { authenticateToken, requireAdmin } = require('../middleware/authMiddleware');

// All admin routes strictly require authentication and the sole administrator identity
router.use(authenticateToken, requireAdmin);

// Dashboard overview & KPIs
router.get('/overview', adminController.getDashboardOverview);

// User management
router.get('/users', adminController.listUsers);
router.get('/users/:id', adminController.getUserDetails);
router.post('/users/:id/status', adminController.updateUserStatus);
router.delete('/users/:id', adminController.deleteUser);
router.post('/users/:id/permissions', adminController.updateUserPermissions);
router.post('/users/:id/temporary-window', adminController.createTemporaryAccessWindow);
router.post('/users/:id/rewards-visibility', adminController.setUserRewardVisibility);

// Old / New classification
router.post('/accounts/reclassify', adminController.reclassifyAccounts);

// Master reward catalog
router.get('/rewards/catalog', adminController.getRewardCatalog);
router.post('/rewards/item', adminController.saveRewardItem);
router.get('/rewards/eligibility', adminController.getRewardEligibility);

// Notification center
router.get('/notifications', adminController.getNotifications);
router.put('/notifications/:id/read', adminController.markNotificationRead);

// Audit logs
router.get('/audit-logs', adminController.getAuditLogs);

module.exports = router;

