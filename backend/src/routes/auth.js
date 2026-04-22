const express = require('express');
const {
  loginOrRegister,
  registerWithPassword,
  setUserPassword,
  initiateRegistration,
  verifyEmailAndCreateAccount,
  initiateForgotPassword,
  resetPassword,
} = require('../services/authService');
const { authMiddleware } = require('../middleware/auth');
const { loginLimiter, emailSendLimiter, otpVerifyLimiter } = require('../middleware/rateLimits');
const { getDb } = require('../config/database');

const router = express.Router();

// ─── Cookie helper ─────────────────────────────────────────────────────────
const isProduction = process.env.NODE_ENV === 'production';

function setSessionCookie(res, token) {
  res.cookie('session', token, {
    httpOnly: true,                                   // JS cannot read this cookie
    secure: isProduction,                             // HTTPS only in production
    sameSite: isProduction ? 'none' : 'lax',          // cross-origin (Vercel→Amvera) needs 'none'
    maxAge: 30 * 24 * 60 * 60 * 1000,                // 30 days
    path: '/',
  });
}

function clearSessionCookie(res) {
  res.clearCookie('session', {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    path: '/',
  });
}

function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.socket.remoteAddress
    || '';
}

// POST /auth/login — login by username or email + password
router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { login, password } = req.body;
    if (!login || typeof login !== 'string' || login.trim().length < 3) {
      return res.status(400).json({ error: 'Введите username или email' });
    }
    const { token, user, sessionId } = await loginOrRegister(login, password || null, req.headers['user-agent'] || '', getClientIp(req));
    setSessionCookie(res, token);
    res.json({ user, sessionId });
  } catch (err) {
    next(err);
  }
});

// POST /auth/register — step 1: validate, send OTP email
router.post('/register', emailSendLimiter, async (req, res, next) => {
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
router.post('/verify-email', otpVerifyLimiter, async (req, res, next) => {
  try {
    const { email, otp } = req.body;
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Email обязателен' });
    }
    if (!otp || typeof otp !== 'string' || !/^\d{6}$/.test(otp.trim())) {
      return res.status(400).json({ error: 'Код должен состоять из 6 цифр' });
    }
    const { token, user, sessionId, isNew } = await verifyEmailAndCreateAccount(email.trim(), otp.trim(), req.headers['user-agent'] || '', getClientIp(req));
    setSessionCookie(res, token);
    res.status(201).json({ user, sessionId, isNew });
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

// POST /auth/forgot-password — send password reset link to email
router.post('/forgot-password', emailSendLimiter, async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Email обязателен' });
    }
    const result = await initiateForgotPassword(email.trim());
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /auth/reset-password — verify token and set new password
router.post('/reset-password', otpVerifyLimiter, async (req, res, next) => {
  try {
    const { id, token, newPassword } = req.body;
    if (!id || typeof id !== 'string') {
      return res.status(400).json({ error: 'Недействительная ссылка' });
    }
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: 'Недействительная ссылка' });
    }
    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 6) {
      return res.status(400).json({ error: 'Пароль: минимум 6 символов' });
    }
    const result = await resetPassword(id, token, newPassword);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /auth/logout — clear session cookie and revoke session in DB
router.post('/logout', authMiddleware, (req, res, next) => {
  try {
    const db = getDb();
    db.prepare('UPDATE sessions SET revoked = 1 WHERE id = ?').run(req.sessionId);
    clearSessionCookie(res);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
