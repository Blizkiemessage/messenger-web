const express = require('express');
const rateLimit = require('express-rate-limit');
const {
  loginOrRegister,
  registerWithPassword,
  setUserPassword,
  initiateRegistration,
  verifyEmailAndCreateAccount,
} = require('../services/authService');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// POST /auth/login — login by username or email + password
router.post('/login', limiter, async (req, res, next) => {
  try {
    const { login, password } = req.body;
    if (!login || typeof login !== 'string' || login.trim().length < 3) {
      return res.status(400).json({ error: 'Введите username или email' });
    }
    const result = await loginOrRegister(login, password || null);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /auth/register — step 1: validate, send OTP email
router.post('/register', limiter, async (req, res, next) => {
  try {
    const { username, email, password } = req.body;
    if (!username || typeof username !== 'string' || username.trim().length < 3) {
      return res.status(400).json({ error: 'Username обязателен (минимум 3 символа)' });
    }
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Email обязателен' });
    }
    if (!password || typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ error: 'Пароль: минимум 6 символов' });
    }
    const result = await initiateRegistration(username.trim(), email.trim(), password);
    res.json(result); // { email }
  } catch (err) {
    next(err);
  }
});

// POST /auth/verify-email — step 2: verify OTP, create account
router.post('/verify-email', limiter, async (req, res, next) => {
  try {
    const { email, otp } = req.body;
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Email обязателен' });
    }
    if (!otp || typeof otp !== 'string' || !/^\d{6}$/.test(otp.trim())) {
      return res.status(400).json({ error: 'Код должен состоять из 6 цифр' });
    }
    const result = await verifyEmailAndCreateAccount(email.trim(), otp.trim());
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

// PATCH /auth/password — set or change password (requires auth)
router.patch('/password', authMiddleware, async (req, res, next) => {
  try {
    const { newPassword, currentPassword } = req.body;
    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 6) {
      return res.status(400).json({ error: 'Пароль: минимум 6 символов' });
    }
    await setUserPassword(req.userId, newPassword, currentPassword || null);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
