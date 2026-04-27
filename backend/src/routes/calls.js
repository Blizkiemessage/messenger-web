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
//
// Supported env vars:
//   TURN_URLS        — comma-separated list of TURN URLs (preferred)
//                      e.g. "turn:relay.example.com:3478,turn:relay.example.com:3478?transport=tcp,turns:relay.example.com:5349"
//   TURN_URL         — single TURN URL (fallback if TURN_URLS not set)
//   TURN_USERNAME    — TURN credential username
//   TURN_CREDENTIAL  — TURN credential password / secret
//
// Providing all 3 variants (UDP, TCP, TLS) greatly improves connectivity across
// restrictive firewalls — TCP/TLS can traverse proxies that block UDP.
router.get('/ice-servers', authMiddleware, (req, res) => {
  const iceServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];

  const turnUsername   = process.env.TURN_USERNAME;
  const turnCredential = process.env.TURN_CREDENTIAL;

  // Accept comma-separated list (TURN_URLS) or single URL (TURN_URL)
  const rawUrls = process.env.TURN_URLS
    ? process.env.TURN_URLS.split(',').map(s => s.trim()).filter(Boolean)
    : process.env.TURN_URL ? [process.env.TURN_URL] : [];

  if (rawUrls.length && turnUsername && turnCredential) {
    // Pass all URLs in a single entry — the browser tries them in order
    // and picks the first that succeeds (UDP → TCP → TLS).
    iceServers.push({
      urls: rawUrls,
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
