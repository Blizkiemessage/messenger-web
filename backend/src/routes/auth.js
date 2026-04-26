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
const { loginLimiter, emailSendLimiter, otpVerifyLimiter, totpVerifyLimiter } = require('../middleware/rateLimits');
const { getDb } = require('../config/database');
const { sign, verify } = require('../utils/jwt');
const { sanitizeUser } = require('../services/userService');
const { v4: uuidv4 } = require('uuid');
const { verifyToken, verifyAndConsumeBackupCode } = require('../utils/totp');

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

// Short-lived cookie used to carry the pending user identity during 2FA step
function setTotpPendingCookie(res, userId) {
  const token = sign({ sub: userId, purpose: 'totp_pending' }, { expiresIn: '5m' });
  res.cookie('totp_pending', token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    maxAge: 5 * 60 * 1000,
    path: '/',
  });
}

function clearTotpPendingCookie(res) {
  res.clearCookie('totp_pending', {
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
// If 2FA is enabled, sets a short-lived totp_pending cookie and returns { requires2FA: true }
router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { login, password } = req.body;
    if (!login || typeof login !== 'string' || login.trim().length < 3) {
      return res.status(400).json({ error: 'Введите username или email' });
    }
    const result = await loginOrRegister(login, password || null, req.headers['user-agent'] || '', getClientIp(req));

    // Check if 2FA is required before issuing the full session
    if (result.totpRequired) {
      setTotpPendingCookie(res, result.userId);
      return res.json({ requires2FA: true });
    }

    setSessionCookie(res, result.token);
    res.json({ user: result.user, sessionId: result.sessionId });
  } catch (err) {
    next(err);
  }
});

// POST /auth/totp-verify — second step of login when 2FA is enabled
router.post('/totp-verify', totpVerifyLimiter, async (req, res, next) => {
  try {
    const { code } = req.body;
    if (!code || typeof code !== 'string') {
      return res.status(400).json({ error: 'Введите код' });
    }

    const pendingToken = req.cookies?.totp_pending;
    if (!pendingToken) {
      return res.status(401).json({ error: 'Сессия истекла. Выполните вход заново.' });
    }

    let payload;
    try {
      payload = verify(pendingToken);
    } catch {
      clearTotpPendingCookie(res);
      return res.status(401).json({ error: 'Сессия истекла. Выполните вход заново.' });
    }

    if (payload.purpose !== 'totp_pending') {
      clearTotpPendingCookie(res);
      return res.status(401).json({ error: 'Неверная сессия' });
    }

    const userId = payload.sub;
    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) {
      clearTotpPendingCookie(res);
      return res.status(401).json({ error: 'Пользователь не найден' });
    }

    // If 2FA was disabled during this flow, reject and force re-login
    if (!user.totp_enabled) {
      clearTotpPendingCookie(res);
      return res.status(401).json({ error: 'Двухфакторная аутентификация отключена. Выполните вход заново.' });
    }

    const trimmed = code.trim();
    let authenticated = false;

    if (/^\d{6}$/.test(trimmed)) {
      authenticated = verifyToken(user.totp_secret, trimmed);
    } else {
      // Backup code format: XXXXXX-XXXXXX
      authenticated = await verifyAndConsumeBackupCode(userId, trimmed, db);
    }

    if (!authenticated) {
      return res.status(401).json({ error: 'Неверный код' });
    }

    // Clear the pending cookie before issuing the full session
    clearTotpPendingCookie(res);

    const now = Date.now();
    db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(now, userId);

    const sessionId = uuidv4();
    db.prepare(
      'INSERT INTO sessions (id, user_id, created_at, revoked, user_agent, last_used_at, ip_address) VALUES (?, ?, ?, 0, ?, ?, ?)'
    ).run(sessionId, userId, now, req.headers['user-agent'] || '', now, getClientIp(req));

    const token = sign({ sub: userId, jti: sessionId });
    setSessionCookie(res, token);

    res.json({ user: sanitizeUser(user, { showPrivate: true }), sessionId });
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
