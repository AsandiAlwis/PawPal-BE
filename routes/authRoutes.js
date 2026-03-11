// routes/authRoutes.js
const express = require('express');
const router = express.Router();
const {
    login,
    getMe,
    googleLogin,
    setup2FA,
    verify2FA,
    disable2FA,
    forgotPassword,
    resetPassword,
    changePassword
} = require('../controllers/authController');
const { protect } = require('../middleware/auth');

router.post('/login', login);
router.post('/google-login', googleLogin);

router.post('/2fa/setup', protect, setup2FA);
router.post('/2fa/verify', protect, verify2FA);
router.post('/2fa/disable', protect, disable2FA);

router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

router.get('/me', protect, getMe);
router.post('/change-password', protect, changePassword);

module.exports = router;