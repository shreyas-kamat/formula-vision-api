const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const { User } = require('../models');
const crypto = require('crypto');

// Helper function to generate access token
function generateAccessToken(payload) {
    return jwt.sign(
        payload,
        process.env.ACCESS_TOKEN_SECRET,
        { expiresIn: '15m' } // Short-lived token for better security
    );
}

// Helper function to generate refresh token
function generateRefreshToken(payload) {
    return jwt.sign(
        payload,
        process.env.REFRESH_TOKEN_SECRET || process.env.ACCESS_TOKEN_SECRET + '_refresh',
        { expiresIn: '7d' } // Long-lived token
    );
}

// User registration with refresh token
exports.register = async (req, res) => {
    const { email, password, username, first_name, last_name } = req.body;

    try {
        const existingUser = await User.findOne({ where: { email } });
        if (existingUser) {
            return res.status(400).json({ error: 'User already exists' });
        }

        // Check if username is already taken
        const existingUsername = await User.findOne({ where: { username } });
        if (existingUsername) { 
            return res.status(400).json({ error: 'Username already taken' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = await User.create({
            email,
            password: hashedPassword,
            username,
            first_name,
            last_name
        });

        res.status(201).json({ message: 'User created successfully', user: newUser });
    } catch (error) {
        console.error('Error creating user:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

// Enhanced login with refresh token
exports.loginWithEmail = async (req, res) => {
    const { email, password } = req.body;

    try {
        const user = await User.findOne({ where: { email } });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid password' });
        }

        // Generate tokens
        const accessToken = generateAccessToken({ userId: user.user_id });
        const refreshToken = generateRefreshToken({ userId: user.user_id });

        // Store refresh token in database
        await User.update(
            { refresh_token: refreshToken, last_login: new Date() },
            { where: { user_id: user.user_id } }
        );

        res.json({ 
            accessToken, 
            refreshToken,
            userId: user.user_id,
            username: user.username,
            expiresIn: 900 // 15 minutes in seconds
        });
    } catch (error) {
        console.error('Error during login:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

// Enhanced login with username
exports.loginWithUsername = async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
    }

    try {
        const user = await User.findOne({ where: { username } });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid password' });
        }

        // Generate tokens
        const accessToken = generateAccessToken({ userId: user.user_id });
        const refreshToken = generateRefreshToken({ userId: user.user_id });

        // Store refresh token in database
        await User.update(
            { refresh_token: refreshToken, last_login: new Date() },
            { where: { user_id: user.user_id } }
        );

        res.json({ 
            accessToken, 
            refreshToken,
            userId: user.user_id,
            expiresIn: 900 // 15 minutes in seconds
        });
    } catch (error) {
        console.error('Error during login:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

// New endpoint to refresh the access token
exports.refreshToken = async (req, res) => {
    const { refreshToken } = req.body;

    if (!refreshToken) {
        return res.status(401).json({ error: 'Refresh token required' });
    }

    try {
        // Verify the refresh token
        const decoded = jwt.verify(
            refreshToken, 
            process.env.REFRESH_TOKEN_SECRET || process.env.ACCESS_TOKEN_SECRET + '_refresh'
        );

        // Find user by userId and confirm refresh token matches
        const user = await User.findOne({ 
            where: { 
                user_id: decoded.userId,
                refresh_token: refreshToken
            } 
        });

        if (!user) {
            return res.status(403).json({ error: 'Invalid refresh token' });
        }

        // Generate a new access token
        const accessToken = generateAccessToken({ userId: user.user_id });

        res.json({ 
            accessToken,
            expiresIn: 900 // 15 minutes in seconds
        });
    } catch (error) {
        console.error('Error refreshing token:', error);
        
        // Check if token is expired
        if (error.name === 'TokenExpiredError') {
            return res.status(403).json({ error: 'Refresh token expired, please log in again' });
        }
        
        return res.status(403).json({ error: 'Invalid refresh token' });
    }
};

// Logout function to invalidate the refresh token
exports.logout = async (req, res) => {
    const { refreshToken } = req.body;
    
    if (!refreshToken) {
        return res.status(400).json({ error: 'Refresh token required' });
    }

    try {
        // Find user by refresh token and clear it
        await User.update(
            { refresh_token: null },
            { where: { refresh_token: refreshToken } }
        );
        
        res.status(200).json({ message: 'Logged out successfully' });
    } catch (error) {
        console.error('Error during logout:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

// Check if username is taken
exports.isUsernameTaken = async (req, res) => {
    const { username } = req.query;

    if (!username) {
        return res.status(400).json({ error: 'Username is required' });
    }

    try {
        const existingUser = await User.findOne({ where: { username } });
        if (existingUser) {
            return res.status(200).json({ isTaken: true, message: 'Username is already taken' });
        }

        res.status(200).json({ isTaken: false, message: 'Username is available' });
    } catch (error) {
        console.error('Error checking username:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

// The rest of your existing functions remain unchanged
exports.validateToken = (req, res) => {
    res.status(200).json({ status: 'VALID', userId: req.user.userId });
};

exports.authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token == null) {
        return res.sendStatus(401); // Unauthorized
    }

    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, user) => {
        if (err) {
            return res.sendStatus(403); // Forbidden
        }

        req.user = user;
        next();
    });
};

// Rest of your existing code (OTP functions, etc.)
let otpStore = {};

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
});

function generateOTP() {
    // Use Math.random for broader Node.js version compatibility
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// Your existing requestPasswordReset and verifyOTPAndResetPassword functions...
exports.requestPasswordReset = (req, res) => {
    const { email } = req.body;

    // Validate email input
    if (!email || !email.includes('@')) {
      return res.status(400).json({ message: 'Invalid email address' });
    }

    const otp = generateOTP();
    const expirationTime = Date.now() + 10 * 60 * 1000;  // OTP expires in 10 minutes

    // Store the OTP with expiration time in memory (replace with DB in production)
    otpStore[email] = { otp, expiresAt: expirationTime };

    // Send OTP to the provided email address
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Password Reset OTP',
      text: `Your One-Time Password (OTP) for resetting your password is: ${otp}`,
    };

    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        return res.status(500).json({ message: 'Error sending OTP', error });
      } else {
        return res.status(200).json({ message: 'OTP sent to your email!' });
      }
    });
};

// Controller function to verify OTP and allow password reset
exports.verifyOTPAndResetPassword = async (req, res) => {
    const { email, otp, newPassword } = req.body;

    try {
      // Validate input
      if (!email || !otp || !newPassword) {
        return res.status(400).json({ message: 'Missing required fields' });
      }

      // Check if OTP exists for the email
      const storedOtp = otpStore[email];
      if (!storedOtp) {
        return res.status(400).json({ message: 'OTP not sent or expired' });
      }

      // Check if OTP is expired
      if (Date.now() > storedOtp.expiresAt) {
        delete otpStore[email];  // Cleanup expired OTP
        return res.status(400).json({ message: 'OTP has expired' });
      }

      // Verify if the OTP is correct
      if (otp !== storedOtp.otp) {
        return res.status(400).json({ message: 'Invalid OTP' });
      }

      // Find the user in the database
      const user = await User.findOne({ where: { email } });
      if (!user) {
        delete otpStore[email];
        return res.status(404).json({ message: 'User not found' });
      }

      // Hash the new password
      const hashedPassword = await bcrypt.hash(newPassword, 10);

      // Update the user's password in the database
      await User.update(
        { password: hashedPassword },
        { where: { email: email } }
      );

      // Clean up the OTP from memory
      delete otpStore[email];

      // Return success response
      return res.status(200).json({ message: 'Password reset successful' });
    } catch (error) {
      console.error('Error during password reset:', error);
      return res.status(500).json({ message: 'Internal server error', error: error.message });
    }
};

// Send verification email
exports.sendVerificationEmail = async (req, res) => {
    const { email } = req.body;

    if (!email || !email.includes('@')) {
        return res.status(400).json({ error: 'Invalid email address' });
    }

    try {
        const user = await User.findOne({ where: { email } });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (user.verified) {
            return res.status(400).json({ error: 'Email is already verified' });
        }

        // Generate verification link
        const verificationLink = `${process.env.FRONTEND_URL}/api/v1/auth/confirm-email-verification?email=${encodeURIComponent(email)}`;

        // Send verification email
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'Verify Your Email Address',
            text: `Click the link below to verify your email address:\n\n${verificationLink}`,
        };

        transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                return res.status(500).json({ error: 'Error sending verification email', details: error });
            } else {
                return res.status(200).json({ message: 'Verification email sent successfully' });
            }
        });
    } catch (error) {
        console.error('Error during email verification:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

// Confirm email verification
exports.confirmEmailVerification = async (req, res) => {
    const { email } = req.query;

    if (!email || !email.includes('@')) {
        return res.status(400).json({ error: 'Invalid email address' });
    }

    try {
        const user = await User.findOne({ where: { email } });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (user.verified) {
            return res.status(400).json({ error: 'Email is already verified' });
        }

        // Update the verified field in the database
        await User.update(
            { verified: true },
            { where: { email } }
        );

        res.status(200).json({ message: 'Email verified successfully' });
    } catch (error) {
        console.error('Error during email confirmation:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};