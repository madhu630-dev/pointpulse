const express = require('express');
const router = express.Router();
const formController = require('../controllers/formController');
const { authenticateToken, requireAdmin } = require('../middleware/authMiddleware');

router.get('/active', authenticateToken, formController.getActiveForm);
router.post('/submit', authenticateToken, formController.submitPeriodicForm);

// Admin-only endpoints
router.get('/submissions', authenticateToken, requireAdmin, formController.getFormSubmissions);
router.put('/submissions/:id/acknowledge', authenticateToken, requireAdmin, formController.acknowledgeSubmission);
router.post('/schedule', authenticateToken, requireAdmin, formController.updateSchedule);
router.post('/send-user', authenticateToken, requireAdmin, formController.sendFormToUser);
router.post('/send-all', authenticateToken, requireAdmin, formController.sendFormToAll);
router.post('/cancel-user', authenticateToken, requireAdmin, formController.cancelFormForUser);
router.get('/user-statuses', authenticateToken, requireAdmin, formController.getUsersReviewStatus);

module.exports = router;

