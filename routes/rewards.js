const express = require('express');
const router = express.Router();
const rewardController = require('../controllers/rewardController');
const { authenticateToken, requirePermission } = require('../middleware/authMiddleware');

router.get('/', authenticateToken, requirePermission('view_redemption'), rewardController.getUserRewards);
router.get('/matches/:rewardId', authenticateToken, requirePermission('view_redemption'), rewardController.getAccountMatchesForReward);
router.post('/:accountId/redeem', authenticateToken, rewardController.redeemItem);
router.get('/history', authenticateToken, requirePermission('view_redemption'), rewardController.getRedemptions);

module.exports = router;
