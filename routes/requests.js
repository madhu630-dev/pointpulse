const express = require('express');
const router = express.Router();
const requestController = require('../controllers/requestController');
const { authenticateToken, requireAdmin } = require('../middleware/authMiddleware');

router.post('/', authenticateToken, requestController.submitRequest);
router.get('/', authenticateToken, requestController.getUserRequests);
router.get('/all', authenticateToken, requireAdmin, requestController.getAllRequests);
router.put('/:id', authenticateToken, requireAdmin, requestController.updateRequestStatus);

module.exports = router;

