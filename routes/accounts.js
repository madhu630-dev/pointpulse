const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const { authenticateToken, requirePermission } = require('../middleware/authMiddleware');
const accountController = require('../controllers/accountController');

const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}
const upload = multer({ dest: 'uploads/' });

// Account routes
router.get('/', authenticateToken, requirePermission('view_accounts'), accountController.getAccounts);
router.get('/editing-status', authenticateToken, accountController.getEditingStatus);
router.get('/:id/details', authenticateToken, accountController.getAccountDetails);
router.post('/:id/correction-request', authenticateToken, accountController.submitAccountCorrectionRequest);
router.post('/', authenticateToken, requirePermission('add_accounts'), accountController.createAccount);
router.put('/:id', authenticateToken, requirePermission('edit_accounts'), accountController.updateAccount);
router.post('/:id/points', authenticateToken, requirePermission('update_points'), accountController.updatePoints);
router.post('/upload-excel', authenticateToken, requirePermission('import_excel'), upload.single('file'), accountController.uploadExcel);
router.get('/export/csv', authenticateToken, requirePermission('download_reports'), accountController.exportCsv);

module.exports = router;
