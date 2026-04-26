/**
 * calls.js — E3 WebRTC: ICE server config + call history
 *
 * GET /calls/ice-servers   → returns ICE server configuration (STUN + optional TURN)
 * GET /calls/history/:chatId → returns call history for a chat (paginated)
 */
const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const { getDb } = require('../config/database');

// ── ICE Servers ──────────────────────────────────────────────────────────────
// Returns STUN + optional TURN credentials from environment variables.
// TURN_URL, TURN_USERNAME, TURN_CREDENTIAL must be set for TURN support.
router.get('/ice-servers', authMiddleware, (req, res) => {
  const iceServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];

  // Add TURN server if configured
  const turnUrl        = process.env.TURN_URL;
  const turnUsername   = process.env.TURN_USERNAME;
  const turnCredential = process.env.TURN_CREDENTIAL;

  if (turnUrl && turnUsername && turnCredential) {
    iceServers.push({
      urls: turnUrl,
      username: turnUsername,
      credential: turnCredential,
    });
  }

  res.json({ iceServers });
});

// ── Call History ─────────────────────────────────────────────────────────────
router.get('/history/:chatId', authMiddleware, (req, res) => {
  const { chatId } = req.params;
  const userId = req.userId;
  const limit  = Math.min(parseInt(req.query.limit) || 30, 100);
  const before = req.query.before ? parseInt(req.query.before) : Date.now();

  const db = getDb();

  // Verify membership
  const member = db
    .prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?')
    .get([chatId, userId]);

  if (!member) return res.status(403).json({ error: 'Access denied' });

  const calls = db.prepare(`
    SELECT
      c.id, c.chat_id, c.caller_id, c.callee_id, c.call_type,
      c.status, c.started_at, c.ended_at, c.duration, c.created_at,
      caller.username  AS caller_username,
      caller.display_name AS caller_display_name,
      callee.username  AS callee_username,
      callee.display_name AS callee_display_name
    FROM calls c
    LEFT JOIN users caller ON caller.id = c.caller_id
    LEFT JOIN users callee ON callee.id = c.callee_id
    WHERE c.chat_id = ? AND c.created_at < ?
    ORDER BY c.created_at DESC
    LIMIT ?
  `).all([chatId, before, limit]);

  res.json({ calls });
});

module.exports = router;
