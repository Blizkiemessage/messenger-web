'use strict';

const express = require('express');
const QRCode = require('qrcode');
const { authMiddleware } = require('../middleware/auth');
const { otpVerifyLimiter } = require('../middleware/rateLimits');
const { getDb } = require('../config/database');
const { sanitizeUser } = require('../services/userService');
const {
  generateSecret,
  generateUri,
  verifyToken,
  generateBackupCodes,
  hashBackupCodes,
  verifyAndConsumeBackupCode,
} = require('../utils/totp');

const router = express.Router();

// All TOTP management routes require a valid session
router.use(authMiddleware);

// GET /totp/status — return current 2FA status for the logged-in user
router.get('/status', (req, res, next) => {
  try {
    const db = getDb();
    const user = db.prepare('SELECT totp_enabled FROM users WHERE id = ?').get(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ enabled: !!user.totp_enabled });
  } catch (err) {
    next(err);
  }
});

// POST /totp/setup — generate a new pending TOTP secret and return QR code
router.post('/setup', async (req, res, next) => {
  try {
    const db = getDb();
    const user = db.prepare('SELECT id, username, totp_enabled FROM users WHERE id = ?').get(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.totp_enabled) {
      return res.status(409).json({ error: 'Двухфакторная аутентификация уже включена' });
    }

    const secret = generateSecret();
    const issuer = process.env.APP_NAME || 'Blizkie';
    const uri = generateUri(secret, user.username || user.id, issuer);

    // Store pending secret (not yet active until confirmed)
    db.prepare('UPDATE users SET totp_pending_secret = ? WHERE id = ?').run(secret, req.userId);

    const qrDataUrl = await QRCode.toDataURL(uri, { width: 256, margin: 2 });

    res.json({ secret, uri, qrDataUrl });
  } catch (err) {
    next(err);
  }
});

// POST /totp/confirm — verify token against pending secret, enable 2FA, return backup codes
router.post('/confirm', otpVerifyLimiter, async (req, res, next) => {
  try {
    const { code } = req.body;
    if (!code || typeof code !== 'string' || !/^\d{6}$/.test(code.trim())) {
      return res.status(400).json({ error: 'Введите 6-значный код' });
    }

    const db = getDb();
    const user = db.prepare('SELECT totp_enabled, totp_pending_secret FROM users WHERE id = ?').get(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.totp_enabled) return res.status(409).json({ error: 'Двухфакторная аутентификация уже включена' });
    if (!user.totp_pending_secret) return res.status(400).json({ error: 'Сначала выполните настройку (POST /totp/setup)' });

    const valid = verifyToken(user.totp_pending_secret, code.trim());
    if (!valid) {
      return res.status(400).json({ error: 'Неверный код. Проверьте время на устройстве.' });
    }

    const plainCodes = generateBackupCodes(10);
    const hashedEntries = await hashBackupCodes(plainCodes);

    db.prepare(`
      UPDATE users
      SET totp_secret = totp_pending_secret,
          totp_pending_secret = NULL,
          totp_enabled = 1,
          totp_backup_codes = ?
      WHERE id = ?
    `).run(JSON.stringify(hashedEntries), req.userId);

    const updatedUser = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
    res.json({
      ok: true,
      backupCodes: plainCodes,
      user: sanitizeUser(updatedUser, { showPrivate: true }),
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /totp/disable — disable 2FA (requires valid TOTP code)
router.delete('/disable', otpVerifyLimiter, async (req, res, next) => {
  try {
    const { code } = req.body;
    if (!code || typeof code !== 'string') {
      return res.status(400).json({ error: 'Введите код для подтверждения' });
    }

    const db = getDb();
    const user = db.prepare('SELECT totp_enabled, totp_secret, totp_backup_codes FROM users WHERE id = ?').get(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user.totp_enabled) return res.status(400).json({ error: 'Двухфакторная аутентификация не включена' });

    const trimmed = code.trim();
    let authenticated = false;

    // Accept either a TOTP code or a backup code
    if (/^\d{6}$/.test(trimmed)) {
      authenticated = verifyToken(user.totp_secret, trimmed);
    } else {
      authenticated = await verifyAndConsumeBackupCode(req.userId, trimmed, db);
    }

    if (!authenticated) {
      return res.status(401).json({ error: 'Неверный код' });
    }

    db.prepare(`
      UPDATE users
      SET totp_enabled = 0, totp_secret = NULL, totp_pending_secret = NULL, totp_backup_codes = NULL
      WHERE id = ?
    `).run(req.userId);

    const updatedUser = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
    res.json({ ok: true, user: sanitizeUser(updatedUser, { showPrivate: true }) });
  } catch (err) {
    next(err);
  }
});

// POST /totp/regenerate-backup — regenerate backup codes (requires valid TOTP code)
router.post('/regenerate-backup', otpVerifyLimiter, async (req, res, next) => {
  try {
    const { code } = req.body;
    if (!code || typeof code !== 'string' || !/^\d{6}$/.test(code.trim())) {
      return res.status(400).json({ error: 'Введите 6-значный TOTP-код' });
    }

    const db = getDb();
    const user = db.prepare('SELECT totp_enabled, totp_secret FROM users WHERE id = ?').get(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user.totp_enabled) return res.status(400).json({ error: 'Двухфакторная аутентификация не включена' });

    const valid = verifyToken(user.totp_secret, code.trim());
    if (!valid) return res.status(401).json({ error: 'Неверный код' });

    const plainCodes = generateBackupCodes(10);
    const hashedEntries = await hashBackupCodes(plainCodes);

    db.prepare('UPDATE users SET totp_backup_codes = ? WHERE id = ?')
      .run(JSON.stringify(hashedEntries), req.userId);

    res.json({ ok: true, backupCodes: plainCodes });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
