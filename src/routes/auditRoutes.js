const express = require('express');
const router = express.Router();
const { getAuditLogs } = require('../controllers/auditController');
const { authenticateToken, authorizeRoles } = require('../middleware/authMiddleware');

// ADMIN only: Paginated audit logs
router.get('/logs', authenticateToken, authorizeRoles('ADMIN'), getAuditLogs);

module.exports = router;
