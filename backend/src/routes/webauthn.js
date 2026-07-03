'use strict';

const { Router } = require('express');
const { v4: uuidv4 } = require('uuid');
const {
  generateRegistrationOptions,
  generateAuthenticationOptions,
  verifyRegistrationResponse,
  verifyAuthenticationResponse,
} = require('@simplewebauthn/server');

const { getDb }          = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const { signAccess, signRefresh } = require('../utils/jwt');
const { sanitizeUser }   = require('../services/userService');
const { webauthnLoginLimiter } = require('../middleware/rateLimits');
const logger             = require('../utils/logger');

const router      = Router();
const IS_PROD     = process.env.NODE_ENV === 'production';

// Log RP config at module load so it's visible in Amvera startup logs.
{
  const { origin, rpID } = getRpConfig();
  console.log(`[WebAuthn] origin=${origin}  rpID=${rpID}`);
}
const CHALLENGE_TTL = 5 * 60 * 1000; // 5 min
const REFRESH_TTL   = 30 * 24 * 60 * 60 * 1000;

// ── RP config ────────────────────────────────────────────────────────────────
// WEBAUTHN_ORIGIN  — full origin of the frontend (e.g. https://app.blizkie.ru)
// WEBAUTHN_RP_ID   — registrable domain suffix  (e.g. blizkie.ru)
// Falls back to ALLOWED_ORIGIN (CORS frontend URL) then APP_URL when not set.
function getRpConfig() {
  // ALLOWED_ORIGIN is the frontend CORS origin and is always the correct WebAuthn
  // origin in cross-origin deployments (Vercel frontend + Amvera backend).
  // Use only the first entry if it is a comma-separated list.
  const allowedOriginFirst = (process.env.ALLOWED_ORIGIN || '')
    .split(',')[0].trim().replace(/\/+$/, '');
  const appUrl = (
    process.env.WEBAUTHN_ORIGIN ||
    allowedOriginFirst ||
    process.env.APP_URL ||
    'http://localhost:5173'
  ).replace(/\/$/, '');
  const rpID = process.env.WEBAUTHN_RP_ID || new URL(appUrl).hostname;
  return { rpID, origin: appUrl, rpName: 'Blizkie' };
}

// ── Cookie helpers (mirrors auth.js) ────────────────────────────────────────
function setSessionCookie(res, token) {
  res.cookie('session', token, {
    httpOnly: true, secure: IS_PROD,
    sameSite: IS_PROD ? 'none' : 'lax',
    maxAge: 15 * 60 * 1000, path: '/',
  });
}
function setRefreshCookie(res, token) {
  res.cookie('refresh', token, {
    httpOnly: true, secure: IS_PROD,
    sameSite: IS_PROD ? 'none' : 'lax',
    maxAge: REFRESH_TTL, path: '/auth/refresh',
  });
}
function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  return fwd ? fwd.split(',')[0].trim() : (req.socket?.remoteAddress || '');
}

// ── Challenge store ──────────────────────────────────────────────────────────
function storeChallenge(db, challenge, userId, type) {
  db.prepare(
    'INSERT OR REPLACE INTO webauthn_challenges (challenge, user_id, type, expires_at) VALUES (?, ?, ?, ?)',
  ).run(challenge, userId ?? null, type, Date.now() + CHALLENGE_TTL);
}

function consumeChallenge(db, challenge, type) {
  db.prepare('DELETE FROM webauthn_challenges WHERE expires_at < ?').run(Date.now());
  const row = db.prepare(
    'SELECT * FROM webauthn_challenges WHERE challenge = ? AND type = ?',
  ).get(challenge, type);
  if (row) db.prepare('DELETE FROM webauthn_challenges WHERE challenge = ?').run(challenge);
  return row || null;
}

// ── Registration ─────────────────────────────────────────────────────────────

router.post('/register/options', authMiddleware, async (req, res, next) => {
  try {
    const db     = getDb();
    const userId = req.userId;
    const { rpID, rpName } = getRpConfig();

    const user = db.prepare('SELECT id, username, display_name FROM users WHERE id = ?').get(userId);
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

    const existing = db.prepare('SELECT id FROM webauthn_credentials WHERE user_id = ?').all(userId);

    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userID:          Buffer.from(String(userId)),
      userName:        user.username,
      userDisplayName: user.display_name || user.username,
      excludeCredentials: existing.map(c => ({ id: c.id, type: 'public-key' })),
      authenticatorSelection: {
        residentKey:      'preferred',
        userVerification: 'preferred',
      },
      attestationType: 'none',
    });

    storeChallenge(db, options.challenge, userId, 'registration');
    res.json(options);
  } catch (err) { next(err); }
});

router.post('/register/verify', authMiddleware, async (req, res, next) => {
  try {
    const db     = getDb();
    const userId = req.userId;
    const { rpID, origin } = getRpConfig();
    const { response, deviceName } = req.body;

    if (!response?.response?.clientDataJSON || !response?.response?.attestationObject) {
      return res.status(400).json({ error: 'Неверный формат ответа аутентификатора' });
    }

    const clientData = JSON.parse(Buffer.from(response.response.clientDataJSON, 'base64url').toString());
    const challengeRow = consumeChallenge(db, clientData.challenge, 'registration');
    if (!challengeRow || challengeRow.user_id !== userId) {
      return res.status(400).json({ error: 'Недействительный или истёкший вызов' });
    }

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response,
        expectedChallenge: clientData.challenge,
        expectedOrigin:    origin,
        expectedRPID:      rpID,
      });
    } catch (verifyErr) {
      // simplewebauthn v9 throws on validation failures (origin/RP_ID mismatch,
      // invalid signature, etc.) instead of returning {verified: false}.
      logger.error('[WebAuthn]', 'register/verify failed', verifyErr, { userId, origin, rpID });
      return res.status(400).json({ error: 'Верификация ключа доступа не прошла' });
    }

    if (!verification.verified) {
      return res.status(400).json({ error: 'Верификация не прошла' });
    }

    // simplewebauthn v9 API: credentialID (Uint8Array) + credentialPublicKey + counter
    // (v10 renamed these to registrationInfo.credential.{id,publicKey,counter})
    const { credentialPublicKey, counter } = verification.registrationInfo;
    db.prepare(
      'INSERT OR REPLACE INTO webauthn_credentials (id, user_id, public_key, counter, device_name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(
      response.id,
      userId,
      Buffer.from(credentialPublicKey),
      counter,
      (deviceName || null),
      Date.now(),
    );

    res.json({ verified: true, credentialId: response.id });
  } catch (err) {
    console.error('[WebAuthn] register/verify CRASH:', err?.constructor?.name, '|', err?.message);
    next(err);
  }
});

// ── Authentication ────────────────────────────────────────────────────────────

router.post('/auth/options', webauthnLoginLimiter, async (req, res, next) => {
  try {
    const db = getDb();
    const { rpID } = getRpConfig();
    const { username } = req.body ?? {};

    let allowCredentials;
    let userId = null;

    if (username) {
      const user = db.prepare('SELECT id FROM users WHERE username = ? OR email = ?').get(username, username);
      if (user) {
        userId = user.id;
        const creds = db.prepare('SELECT id FROM webauthn_credentials WHERE user_id = ?').all(userId);
        allowCredentials = creds.map(c => ({ id: c.id, type: 'public-key' }));
      }
    }

    const options = await generateAuthenticationOptions({
      rpID,
      allowCredentials: allowCredentials ?? [],
      userVerification: 'preferred',
    });

    storeChallenge(db, options.challenge, userId, 'authentication');
    res.json(options);
  } catch (err) { next(err); }
});

router.post('/auth/verify', webauthnLoginLimiter, async (req, res, next) => {
  try {
    const db = getDb();
    const { rpID, origin } = getRpConfig();
    const { response } = req.body;

    const clientData   = JSON.parse(Buffer.from(response.response.clientDataJSON, 'base64url').toString());
    const challengeRow = consumeChallenge(db, clientData.challenge, 'authentication');
    if (!challengeRow) {
      return res.status(400).json({ error: 'Недействительный или истёкший вызов' });
    }

    const cred = db.prepare('SELECT * FROM webauthn_credentials WHERE id = ?').get(response.id);
    if (!cred) return res.status(400).json({ error: 'Ключ доступа не найден' });

    let verification;
    try {
      // simplewebauthn v9 API: uses `authenticator` with Uint8Array credentialID.
      // (v10 renamed this to `credential` with base64url string id)
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: clientData.challenge,
        expectedOrigin:    origin,
        expectedRPID:      rpID,
        authenticator: {
          credentialID:        Buffer.from(cred.id, 'base64url'),
          credentialPublicKey: new Uint8Array(cred.public_key),
          counter:             cred.counter,
        },
      });
    } catch (verifyErr) {
      console.error('[WebAuthn] auth/verify CRASH:', verifyErr?.constructor?.name, '|', verifyErr?.message);
      logger.error('[WebAuthn]', 'auth/verify failed', verifyErr, { origin, rpID, credId: response.id });
      return res.status(401).json({ error: 'Аутентификация не прошла' });
    }

    if (!verification.verified) {
      console.error('[WebAuthn] auth/verify: verified=false');
      return res.status(401).json({ error: 'Аутентификация не прошла' });
    }

    // v9 API: authenticationInfo.newCounter
    const newCounter = verification.authenticationInfo?.newCounter ?? verification.authenticationInfo?.counter ?? 0;
    db.prepare('UPDATE webauthn_credentials SET counter = ? WHERE id = ?')
      .run(newCounter, cred.id);

    const userId = cred.user_id;
    const user   = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

    const now            = Date.now();
    const sessionId      = uuidv4();
    const refreshTokenId = uuidv4();

    db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(now, userId);
    db.prepare(
      'INSERT INTO sessions (id, user_id, created_at, revoked, user_agent, last_used_at, ip_address) VALUES (?, ?, ?, 0, ?, ?, ?)',
    ).run(sessionId, userId, now, req.headers['user-agent'] || '', now, getClientIp(req));
    db.prepare(
      'INSERT INTO refresh_tokens (id, session_id, user_id, expires_at, revoked, created_at) VALUES (?, ?, ?, ?, 0, ?)',
    ).run(refreshTokenId, sessionId, userId, now + REFRESH_TTL, now);

    const accessToken  = signAccess({ sub: userId, jti: sessionId });
    const refreshToken = signRefresh({ sub: userId, jti: refreshTokenId, purpose: 'refresh' });

    setSessionCookie(res, accessToken);
    setRefreshCookie(res, refreshToken);

    res.json({
      user: sanitizeUser(user, { showPrivate: true }),
      sessionId,
      token:        accessToken,
      refreshToken,
    });
  } catch (err) { next(err); }
});

// ── Credential management ─────────────────────────────────────────────────────

router.get('/credentials', authMiddleware, (req, res, next) => {
  try {
    const creds = getDb().prepare(
      'SELECT id, device_name, created_at FROM webauthn_credentials WHERE user_id = ? ORDER BY created_at DESC',
    ).all(req.userId);
    res.json(creds);
  } catch (err) { next(err); }
});

router.patch('/credentials/:id', authMiddleware, (req, res, next) => {
  try {
    const { name } = req.body ?? {};
    const result   = getDb().prepare(
      'UPDATE webauthn_credentials SET device_name = ? WHERE id = ? AND user_id = ?',
    ).run((typeof name === 'string' ? name.slice(0, 64) : null) || null, req.params.id, req.userId);
    if (result.changes === 0) return res.status(404).json({ error: 'Ключ не найден' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.delete('/credentials/:id', authMiddleware, (req, res, next) => {
  try {
    const result = getDb().prepare(
      'DELETE FROM webauthn_credentials WHERE id = ? AND user_id = ?',
    ).run(req.params.id, req.userId);
    if (result.changes === 0) return res.status(404).json({ error: 'Ключ не найден' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
