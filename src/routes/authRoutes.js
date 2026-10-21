const express = require('express');
const router = express.Router();
const { sendOtp, verifyOtp, login, registerCitizen, getMe } = require('../controllers/authController');
const { authenticateToken } = require('../middleware/authMiddleware');

router.post('/send-otp', sendOtp);
router.post('/verify-otp', verifyOtp);
router.post('/login', login);
router.post('/register', registerCitizen);
router.get('/me', authenticateToken, getMe);

module.exports = router;
