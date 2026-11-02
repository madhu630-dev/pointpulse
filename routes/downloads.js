const express = require('express');
const router = express.Router();
const downloadController = require('../controllers/downloadController');
const { authenticateToken, requireAdmin, requirePermission } = require('../middleware/authMiddleware');

// Public secure expiring download link via token
router.get('/secure/:token', downloadController.downloadViaToken);

// Authenticated download endpoints
router.post('/generate', authenticateToken, requirePermission('download_reports'), downloadController.generateReport);
router.post('/request', authenticateToken, downloadController.requestDownload);
router.put('/requests/:id/approve', authenticateToken, requireAdmin, downloadController.approveDownloadRequest);

module.exports = router;

