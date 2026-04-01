const express = require('express');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const { getDb } = require('../config/database');
const { getVapidPublicKey } = require('../utils/webPush');

// GET /push/vapid-public-key — returns VAPID public key (no auth needed)
router.get('/vapid-public-key', (req, res) => {
  const key = getVapidPublicKey();
  if (!key) return res.status(503).json({ error: 'Push notifications not configured' });
  res.json({ publicKey: key });
});

// POST /push/subscribe — save or update a push subscription
router.post('/subscribe', authMiddleware, (req, res) => {
  const { endpoint, keys } = req.body || {};
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ error: 'Invalid subscription object' });
  }
  const db = getDb();
  const existing = db.prepare('SELECT id FROM push_subscriptions WHERE endpoint = ?').get(endpoint);
  if (existing) {
    // Update keys in case they changed
    db.prepare('UPDATE push_subscriptions SET p256dh = ?, auth_key = ? WHERE id = ?')
      .run([keys.p256dh, keys.auth, existing.id]);
  } else {
    db.prepare(
      'INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth_key, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run([uuidv4(), req.userId, endpoint, keys.p256dh, keys.auth, Date.now()]);
  }
  res.json({ ok: true });
});

// DELETE /push/subscribe — remove subscription by endpoint
router.delete('/subscribe', authMiddleware, (req, res) => {
  const { endpoint } = req.body || {};
  if (!endpoint) return res.status(400).json({ error: 'endpoint required' });
  const db = getDb();
  db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?').run([endpoint, req.userId]);
  res.json({ ok: true });
});

module.exports = router;
