const express = require('express');
const authController = require('../controllers/auth.controller');

const authRouter = express.Router();

authRouter.post('/register', authController.register);
authRouter.post('/login-email', authController.loginWithEmail);
authRouter.post('/login-username', authController.loginWithUsername);
authRouter.get('/validate', authController.authenticateToken, authController.validateToken);
authRouter.post('/forgot-password', authController.requestPasswordReset);
authRouter.post('/reset-password', authController.verifyOTPAndResetPassword);
authRouter.post('/refresh-token', authController.refreshToken); 
authRouter.post('/logout', authController.logout); 
authRouter.get('/check-username', authController.isUsernameTaken);
authRouter.post('/send-verification-email', authController.sendVerificationEmail);
authRouter.get('/confirm-email-verification', authController.confirmEmailVerification);

module.exports = authRouter;