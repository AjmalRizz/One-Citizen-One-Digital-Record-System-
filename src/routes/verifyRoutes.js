const express = require('express');
const router = express.Router();
const { verifyQrToken } = require('../controllers/verifyController');

// Public or authorized QR verification endpoint
router.get('/qr/:qrToken', verifyQrToken);
router.get('/qr', verifyQrToken);
router.post('/qr', verifyQrToken);

module.exports = router;
