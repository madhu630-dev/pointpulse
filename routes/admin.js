const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { authenticateToken, requireAdmin } = require('../middleware/authMiddleware');

// All admin routes strictly require authentication and the sole administrator identity
router.use(authenticateToken, requireAdmin);

// Dashboard overview & KPIs
router.get('/overview', adminController.getDashboardOverview);

// User management & Editing periods
router.get('/users', adminController.listUsers);
router.get('/users/:id', adminController.getUserDetails);
router.post('/users/:id/status', adminController.updateUserStatus);
router.delete('/users/:id', adminController.deleteUser);
router.post('/users/:id/permissions', adminController.updateUserPermissions);
router.post('/users/:id/temporary-window', adminController.createTemporaryAccessWindow);
router.post('/users/:id/rewards-visibility', adminController.setUserRewardVisibility);
router.post('/users/:id/assign-accounts', adminController.assignAccountsToUser);
router.post('/users/:id/claim-all-accounts', adminController.assignAllAccountsToUser);
router.post('/assign-all-accounts', adminController.assignAllAccountsToUser);
router.get('/editing-periods', adminController.getEditingPeriodConfig);
router.post('/editing-periods', adminController.saveEditingPeriodConfig);
router.post('/accounts/correction-review', adminController.reviewAccountCorrectionRequest);

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

