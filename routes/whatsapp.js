const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../middleware/authMiddleware');
const whatsappController = require('../controllers/whatsappController');

// Webhook Endpoints
router.get('/webhook', whatsappController.verifyWebhook);
router.post('/webhook', whatsappController.handleWebhook);

// Bot Simulator / Test Endpoint (Protected)
router.post('/test-message', authenticateToken, requireAdmin, whatsappController.testMessage);

// Authorized Users CRUD
router.get('/users', authenticateToken, requireAdmin, whatsappController.getAuthorizedUsers);
router.post('/users', authenticateToken, requireAdmin, whatsappController.createAuthorizedUser);
router.put('/users/:id', authenticateToken, requireAdmin, whatsappController.updateAuthorizedUser);
router.delete('/users/:id', authenticateToken, requireAdmin, whatsappController.deleteAuthorizedUser);

// Direct WhatsApp Scanner / Client Endpoints
router.get('/client/status', authenticateToken, requireAdmin, whatsappController.getBaileysStatus);
router.post('/client/start', authenticateToken, requireAdmin, whatsappController.startBaileys);
router.post('/client/disconnect', authenticateToken, requireAdmin, whatsappController.disconnectBaileys);

module.exports = router;
