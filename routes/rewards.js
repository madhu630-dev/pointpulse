const express = require('express');
const router = express.Router();

const { authenticateToken, requireAdmin } = require('../middleware/authMiddleware');
const rewardController = require('../controllers/rewardController');

router.post('/:id/redeem', authenticateToken, requireAdmin, rewardController.redeemItem);
router.get('/inventory', authenticateToken, requireAdmin, rewardController.getInventory);
router.put('/inventory/:id', authenticateToken, requireAdmin, rewardController.updateRedemption);
router.delete('/inventory/:id', authenticateToken, requireAdmin, rewardController.deleteRedemption);

module.exports = router;
