const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const { authenticateToken, requireAdmin } = require('../middleware/authMiddleware');
const accountController = require('../controllers/accountController');

const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}
const upload = multer({ dest: 'uploads/' });

router.post('/upload-excel', authenticateToken, requireAdmin, upload.single('file'), accountController.uploadExcel);
router.get('/export/csv', authenticateToken, requireAdmin, accountController.exportCsv);
router.get('/export/pdf', authenticateToken, requireAdmin, accountController.exportPdf);
router.post('/export/filtered-pdf', authenticateToken, requireAdmin, accountController.exportFilteredPdf);
router.get('/export/pdf/:id', authenticateToken, requireAdmin, accountController.exportAccountPdf);
router.post('/export/detailed', authenticateToken, requireAdmin, accountController.exportDetailed);
router.post('/export/points-list', authenticateToken, requireAdmin, accountController.exportPointsList);
router.get('/', authenticateToken, accountController.getAccounts);
router.post('/', authenticateToken, requireAdmin, accountController.createAccount);
router.put('/:id', authenticateToken, requireAdmin, accountController.updateAccount);

module.exports = router;
