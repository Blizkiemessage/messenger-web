const express = require('express');
const rateLimit = require('express-rate-limit');
const { loginOrRegister, registerWithPassword, setUserPassword } = require('../services/authService');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// POST /auth/login — username-only OR username+password login
router.post('/login', limiter, async (req, res, next) => {
  try {
    const { username, password } = req.body;
    if (!username || typeof username !== 'string' || username.trim().length < 3) {
      return res.status(400).json({ error: 'Username обязателен (минимум 3 символа)' });
    }
    const result = await loginOrRegister(username, password || null);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /auth/register — explicit registration with username + password
router.post('/register', limiter, async (req, res, next) => {
  try {
    const { username, password } = req.body;
    if (!username || typeof username !== 'string' || username.trim().length < 3) {
      return res.status(400).json({ error: 'Username обязателен (минимум 3 символа)' });
    }
    if (!password || typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ error: 'Пароль: минимум 6 символов' });
    }
    const result = await registerWithPassword(username, password);
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
