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
const { loginLimiter, emailSendLimiter, registrationLimiter, otpVerifyLimiter, totpVerifyLimiter, refreshLimiter } = require('../middleware/rateLimits');
const { getDb } = require('../config/database');
const { sign, signAccess, signRefresh, verify } = require('../utils/jwt');
const { sanitizeUser } = require('../services/userService');
const { v4: uuidv4 } = require('uuid');
const { verifyTotp, verifyAndConsumeBackupCode } = require('../utils/totp');

const router = express.Router();

// ─── Cookie helper ─────────────────────────────────────────────────────────
const isProduction = process.env.NODE_ENV === 'production';

// Access token cookie — 15 minutes.
function setSessionCookie(res, token) {
  res.cookie('session', token, {
    httpOnly: true,                                   // JS cannot read this cookie
    secure: isProduction,                             // HTTPS only in production
    sameSite: isProduction ? 'none' : 'lax',          // cross-origin (Vercel→Amvera) needs 'none'
    maxAge: 15 * 60 * 1000,                           // 15 minutes (access token lifetime)
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

// Refresh token cookie — 30 days. Sent ONLY to /auth/refresh.
function setRefreshCookie(res, token) {
  res.cookie('refresh', token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000,                // 30 days
    path: '/auth/refresh',                            // scoped — browser only sends it to this path
  });
}

function clearRefreshCookie(res) {
  res.clearCookie('refresh', {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    path: '/auth/refresh',
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
// If 2FA is enabled, returns a short-lived pendingToken in the response body.
// We intentionally avoid a totp_pending cookie here because cross-origin
// (Vercel → Amvera) third-party cookies are blocked by modern browsers
// (Chrome incognito, Chrome 120+ privacy sandbox) even with SameSite=None.
router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { login, password } = req.body;
    if (!login || typeof login !== 'string' || login.trim().length < 3) {
      return res.status(400).json({ error: 'Введите username или email' });
    }
    const result = await loginOrRegister(login, password || null, req.headers['user-agent'] || '', getClientIp(req));

    // Check if 2FA is required before issuing the full session
    if (result.totpRequired) {
      // Use a short-lived JWT in the response body instead of a cookie —
      // cookies are unreliable for cross-origin (Vercel ↔ Amvera) deployments.
      const pendingToken = sign({ sub: result.userId, purpose: 'totp_pending' }, { expiresIn: '5m' });
      clearTotpPendingCookie(res); // clear any stale pending cookie
      return res.json({ requires2FA: true, pendingToken });
    }

    setSessionCookie(res, result.accessToken);
    setRefreshCookie(res, result.refreshToken);
    // Also return tokens in body so cross-origin clients (Vercel → Amvera) can
    // store them and send as Authorization: Bearer, bypassing Chrome's third-party
    // cookie blocking (Privacy Sandbox / incognito).
    // `token` kept for backward compat with older clients.
    res.json({
      user: result.user,
      sessionId: result.sessionId,
      token: result.accessToken,
      refreshToken: result.refreshToken,
    });
  } catch (err) {
    next(err);
  }
});

// POST /auth/totp-verify — second step of login when 2FA is enabled
// Accepts pendingToken from the request body (preferred, cross-origin safe)
// or falls back to the legacy totp_pending cookie for backward compatibility.
router.post('/totp-verify', totpVerifyLimiter, async (req, res, next) => {
  try {
    const { code, pendingToken: bodyToken } = req.body;
    if (!code || typeof code !== 'string') {
      return res.status(400).json({ error: 'Введите код' });
    }

    // Prefer body token (cross-origin safe); fall back to cookie (same-origin legacy)
    const pendingToken = bodyToken || req.cookies?.totp_pending;
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
      authenticated = verifyTotp(user.totp_secret, trimmed);
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

    const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
    const sessionId      = uuidv4();
    const refreshTokenId = uuidv4();

    db.prepare(
      'INSERT INTO sessions (id, user_id, created_at, revoked, user_agent, last_used_at, ip_address) VALUES (?, ?, ?, 0, ?, ?, ?)'
    ).run(sessionId, userId, now, req.headers['user-agent'] || '', now, getClientIp(req));

    db.prepare(
      'INSERT INTO refresh_tokens (id, session_id, user_id, expires_at, revoked, created_at) VALUES (?, ?, ?, ?, 0, ?)'
    ).run(refreshTokenId, sessionId, userId, now + REFRESH_TTL_MS, now);

    const accessToken  = signAccess({ sub: userId, jti: sessionId });
    const refreshToken = signRefresh({ sub: userId, jti: refreshTokenId, purpose: 'refresh' });

    setSessionCookie(res, accessToken);
    setRefreshCookie(res, refreshToken);

    // Return tokens in body for cross-origin clients (same as /auth/login)
    res.json({
      user: sanitizeUser(user, { showPrivate: true }),
      sessionId,
      token: accessToken,
      refreshToken,
    });
  } catch (err) {
    next(err);
  }
});

// POST /auth/register — step 1: validate, send OTP email
router.post('/register', registrationLimiter, async (req, res, next) => {
  try {
    const { username, email, password } = req.body;
    if (!username || typeof username !== 'string' || username.trim().length < 3) {
      return res.status(400).json({ error: 'Username обязателен (минимум 3 символа)' });
    }
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Email обязателен' });
    }
    // Presence/type only — the full policy (min 8 + digit/special) is enforced
    // once, by validatePassword inside the service, so the rules never drift.
    if (!password || typeof password !== 'string') {
      return res.status(400).json({ error: 'Введите пароль' });
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
    const { accessToken, refreshToken, user, sessionId, isNew } = await verifyEmailAndCreateAccount(email.trim(), otp.trim(), req.headers['user-agent'] || '', getClientIp(req));
    setSessionCookie(res, accessToken);
    setRefreshCookie(res, refreshToken);
    res.status(201).json({ user, sessionId, isNew, token: accessToken, refreshToken });
  } catch (err) {
    next(err);
  }
});

// PATCH /auth/password — set or change password (requires auth)
router.patch('/password', authMiddleware, async (req, res, next) => {
  try {
    const { newPassword, currentPassword } = req.body;
    // Policy (min 8 + digit/special) enforced by validatePassword in the service.
    if (!newPassword || typeof newPassword !== 'string') {
      return res.status(400).json({ error: 'Введите новый пароль' });
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
    // Policy (min 8 + digit/special) enforced by validatePassword in the service.
    if (!newPassword || typeof newPassword !== 'string') {
      return res.status(400).json({ error: 'Введите новый пароль' });
    }
    const result = await resetPassword(id, token, newPassword);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /auth/logout — clear session + refresh cookies and revoke both in DB
router.post('/logout', authMiddleware, (req, res, next) => {
  try {
    const db = getDb();
    // Revoking the session cascades to refresh_tokens via ON DELETE CASCADE,
    // but we also explicitly revoke to handle the case where the session row
    // stays (soft-delete pattern) and only the refresh token is invalidated.
    db.prepare('UPDATE sessions      SET revoked = 1 WHERE id = ?').run(req.sessionId);
    db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE session_id = ?').run(req.sessionId);
    clearSessionCookie(res);
    clearRefreshCookie(res);
    // Force-disconnect any live sockets bound to this session immediately.
    req.app.get('io')?.kickSession?.(req.sessionId);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /auth/refresh — issue a new access token + rotated refresh token.
//
// Security model (refresh token rotation):
//   1. Validate the incoming refresh token (JWT signature + DB lookup).
//   2. Immediately revoke the used refresh token in DB (one-time use).
//   3. Issue a brand-new refresh token and store it in DB.
//   4. Issue a new short-lived access token.
//
// Rotation means a stolen refresh token is detected on first re-use:
// the legitimate user's next refresh will find the token already revoked.
//
// Accepts the refresh token from the HttpOnly cookie (same-origin / Safari)
// OR from the request body (cross-origin clients: Vercel → Amvera).
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

router.post('/refresh', refreshLimiter, async (req, res, next) => {
  try {
    const incomingRefreshToken = req.cookies?.refresh || req.body?.refreshToken;
    if (!incomingRefreshToken) {
      return res.status(401).json({ error: 'Refresh token missing' });
    }

    let payload;
    try {
      payload = verify(incomingRefreshToken);
    } catch {
      return res.status(401).json({ error: 'Refresh token invalid or expired' });
    }

    if (payload.purpose !== 'refresh') {
      return res.status(401).json({ error: 'Invalid token type' });
    }

    const db = getDb();
    const rt = db
      .prepare('SELECT * FROM refresh_tokens WHERE id = ? AND revoked = 0')
      .get(payload.jti);

    if (!rt || rt.expires_at < Date.now()) {
      // Token already revoked or expired — could be a replay attack.
      // Revoke the entire session so the attacker cannot use any token.
      if (rt) {
        db.prepare('UPDATE sessions      SET revoked = 1 WHERE id = ?').run(rt.session_id);
        db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE session_id = ?').run(rt.session_id);
      }
      clearSessionCookie(res);
      clearRefreshCookie(res);
      return res.status(401).json({ error: 'Refresh token revoked or expired' });
    }

    // Check the parent session is still active
    const session = db
      .prepare('SELECT id, revoked FROM sessions WHERE id = ? AND revoked = 0')
      .get(rt.session_id);

    if (!session) {
      return res.status(401).json({ error: 'Session revoked' });
    }

    const now = Date.now();

    // ── Rotation ────────────────────────────────────────────────────────────
    // Step 1: revoke the incoming refresh token (single-use enforcement)
    db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE id = ?').run(payload.jti);

    // Step 2: create a new refresh token with a fresh 30-day window
    const newRefreshTokenId = uuidv4();
    db.prepare(
      'INSERT INTO refresh_tokens (id, session_id, user_id, expires_at, revoked, created_at) VALUES (?, ?, ?, ?, 0, ?)'
    ).run([newRefreshTokenId, rt.session_id, rt.user_id, now + REFRESH_TTL_MS, now]);

    const newRefreshToken = signRefresh({ sub: rt.user_id, jti: newRefreshTokenId, purpose: 'refresh' });

    // Step 3: issue new short-lived access token (same session jti for authMiddleware)
    const newAccessToken = signAccess({ sub: rt.user_id, jti: rt.session_id });

    // Update cookies
    setSessionCookie(res, newAccessToken);
    setRefreshCookie(res, newRefreshToken);

    // Update session activity
    db.prepare('UPDATE sessions SET last_used_at = ? WHERE id = ?').run(now, rt.session_id);

    // Return both tokens in body so cross-origin clients can update their storage
    res.json({ token: newAccessToken, refreshToken: newRefreshToken });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
