/**
 * routes/invites.js — постоянные личные пригласительные ссылки (Этап B).
 *
 *   GET  /invites/:token/resolve  — публично: инфа о пригласившем (для лендинга)
 *   GET  /invites/me              — моя ссылка + QR (создаётся при первом запросе)
 *   POST /invites/me/regenerate   — отозвать старую, выпустить новую
 *   POST /invites/:token/accept   — принять (друзья + ЛС). Требует входа.
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const QRCode = require('qrcode');
const { authMiddleware } = require('../middleware/auth');
const { getDb } = require('../config/database');
const { getChatById } = require('../services/chat/queries');
const { sanitizeUser } = require('../services/userService');
const inv = require('../services/inviteService');

const router = express.Router();

const limiter = rateLimit({
  windowMs: 60 * 1000, max: 60,
  message: { error: 'Too many requests' },
  standardHeaders: true, legacyHeaders: false,
});

function buildLink(req, token) {
  // Origin вызывающего фронта приоритетнее APP_URL: ссылка должна вести на
  // приложение (Vercel), даже если APP_URL указывает на backend.
  const base = (req.headers.origin || process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
  return `${base}/?invite=${encodeURIComponent(token)}`;
}

async function tokenPayload(req, token, used_count) {
  const link = buildLink(req, token);
  let qr = null;
  try { qr = await QRCode.toDataURL(link, { margin: 1, width: 256 }); } catch { /* qr optional */ }
  return { token, link, qr, used_count };
}

// ── Публичный resolve (до auth-гейта) ────────────────────────────────────────
router.get('/:token/resolve', limiter, (req, res, next) => {
  try { res.json(inv.resolveToken(req.params.token)); } catch (err) { next(err); }
});

// ── Дальше — только для авторизованных ───────────────────────────────────────
router.use(authMiddleware);

router.get('/me', async (req, res, next) => {
  try {
    const { token, used_count } = inv.getOrCreateMyToken(req.userId);
    res.json(await tokenPayload(req, token, used_count));
  } catch (err) { next(err); }
});

router.post('/me/regenerate', limiter, async (req, res, next) => {
  try {
    const { token, used_count } = inv.regenerateMyToken(req.userId);
    res.json(await tokenPayload(req, token, used_count));
  } catch (err) { next(err); }
});

router.post('/:token/accept', limiter, (req, res, next) => {
  try {
    const result = inv.acceptToken(req.params.token, req.userId);
    if (result.self) return res.json({ self: true });

    // Обогащение чата делаем здесь (сервис от getChatById намеренно отвязан)
    const chat = getChatById(result.chatId, req.userId);
    const db = getDb();
    const inviterUser = sanitizeUser(db.prepare('SELECT * FROM users WHERE id = ?').get(result.inviterId));

    // Realtime: пригласившему — новый чат в списке (с его перспективой)
    const io = req.app.get('io');
    if (io) {
      try {
        const inviterChat = getChatById(result.chatId, result.inviterId);
        io.to(`user:${result.inviterId}`).emit('chat-created', inviterChat);
      } catch { /* не критично */ }
    }

    res.status(201).json({ chatId: result.chatId, chat, inviter: inviterUser });
  } catch (err) { next(err); }
});

module.exports = router;
