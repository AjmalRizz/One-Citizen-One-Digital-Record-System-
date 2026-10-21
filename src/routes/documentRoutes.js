const express = require('express');
const router = express.Router();
const { uploadDocument, getCitizenDocuments, downloadDocument, deleteDocument } = require('../controllers/documentController');
const { authenticateToken } = require('../middleware/authMiddleware');
const { upload } = require('../middleware/uploadMiddleware');

// Upload document (PDF / Images up to 10MB)
router.post('/upload', authenticateToken, upload.single('file'), uploadDocument);

// Get list of documents for a citizen
router.get('/:citizenId', authenticateToken, getCitizenDocuments);

// Stream document content
router.get('/file/:docId', authenticateToken, downloadDocument);

// Delete document
router.delete('/:docId', authenticateToken, deleteDocument);

module.exports = router;
