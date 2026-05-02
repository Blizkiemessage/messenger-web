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
// Returns STUN + optional TURN credentials.
//
// Supported env vars:
//   METERED_API_KEY  — (recommended) Metered.ca API key for DYNAMIC credentials.
//                      Fresh time-limited credentials are generated per request.
//                      Sign up at https://www.metered.ca/stun-turn
//
//   TURN_URLS        — comma-separated TURN URLs (used with static creds below)
//                      e.g. "turn:relay.example.com:3478,turn:relay.example.com:3478?transport=tcp,turns:relay.example.com:5349"
//   TURN_URL         — single TURN URL (fallback if TURN_URLS not set)
//   TURN_USERNAME    — static TURN credential username  ⚠ expires with Metered!
//   TURN_CREDENTIAL  — static TURN credential password  ⚠ expires with Metered!
//
// IMPORTANT: Metered.ca static credentials (TURN_USERNAME/CREDENTIAL) expire.
// Use METERED_API_KEY for automatic fresh credentials, or host your own TURN server.

// In-memory cache so we don't call the Metered API on every ice-servers request.
// Metered credentials typically expire in 24 h; cache for 1 h to be safe.
let _meteredCache = null; // { iceServers: [...], expiresAt: number }

async function fetchMeteredServers(apiKey) {
  // Return cached if still fresh
  if (_meteredCache && Date.now() < _meteredCache.expiresAt) {
    return _meteredCache.iceServers;
  }

  const url = `https://global.relay.metered.ca/api/v1/turn/credentials?apiKey=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Metered API ${res.status}`);

  const servers = await res.json(); // Array of { urls, username, credential }
  _meteredCache = { iceServers: servers, expiresAt: Date.now() + 60 * 60 * 1000 };
  console.log(`[ICE] Fetched ${servers.length} Metered TURN servers (cached 1 h)`);
  return servers;
}

router.get('/ice-servers', authMiddleware, async (req, res) => {
  const stunServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];

  // ── Path 1: Metered dynamic credentials (recommended) ────────────────────
  const meteredApiKey = process.env.METERED_API_KEY;
  if (meteredApiKey) {
    try {
      const meteredServers = await fetchMeteredServers(meteredApiKey);
      // Metered returns their own STUN servers — merge with Google's
      return res.json({ iceServers: [...stunServers, ...meteredServers] });
    } catch (err) {
      console.error('[ICE] Metered API failed, falling back to static config:', err.message);
      // Fall through to static path below
    }
  }

  // ── Path 2: Static credentials from environment variables ─────────────────
  const iceServers = [...stunServers];
  const turnUsername   = process.env.TURN_USERNAME;
  const turnCredential = process.env.TURN_CREDENTIAL;

  // Accept comma-separated list (TURN_URLS) or single URL (TURN_URL)
  const rawUrls = process.env.TURN_URLS
    ? process.env.TURN_URLS.split(',').map(s => s.trim()).filter(Boolean)
    : process.env.TURN_URL ? [process.env.TURN_URL] : [];

  if (rawUrls.length && turnUsername && turnCredential) {
    // Add each URL as a separate entry — more compatible than array-of-URLs
    // because some browsers only try the first URL in an array entry.
    for (const url of rawUrls) {
      iceServers.push({ urls: url, username: turnUsername, credential: turnCredential });
    }
  }

  console.log(`[ICE] Returning ${iceServers.length} ICE servers (${rawUrls.length} TURN)`);
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
