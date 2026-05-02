/**
 * calls.js — E3 WebRTC: ICE server config + call history
 *
 * GET /calls/ice-servers   → returns ICE server configuration (STUN + optional TURN)
 * GET /calls/history/:chatId → returns call history for a chat (paginated)
 */
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
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
// IMPORTANT: Metered.ca static credentials (TURN_USERNAME/CREDENTIAL) expire every 24 h.
//
// Best approach — METERED_TURN_SECRET (generates fresh credentials locally, no API call):
//   1. In Metered dashboard → TURN Servers → copy "TURN Server Secret"
//   2. Set env var: METERED_TURN_SECRET=<secret>
//   3. Set TURN_URLS (comma-separated) — same URLs as before
//   Credentials are generated via HMAC-SHA1 (RFC 8489), valid 24 h, no outbound API call.
//
// Fallback — METERED_API_KEY (calls Metered REST API; may fail if outbound HTTPS blocked):
//   Set env var: METERED_API_KEY=<api_key>
//
// Last resort — Static credentials (expire every 24 h, manual rotation required):
//   TURN_URLS / TURN_USERNAME / TURN_CREDENTIAL

// ── Path 1: Local HMAC credential generation (best — no external API call) ──────────
// Implements RFC 8489 Time-Limited Credential Mechanism.
// username = "<expiry_unix_seconds>"
// credential = base64(HMAC-SHA1(turn_secret, username))
function generateHmacCredentials(turnSecret) {
  const expiry = Math.floor(Date.now() / 1000) + 86400; // valid 24 h
  const username = String(expiry);
  const credential = crypto.createHmac('sha1', turnSecret).update(username).digest('base64');
  return { username, credential };
}

// ── Path 2: Metered REST API (cached 1 h) ──────────────────────────────────────────
let _meteredCache = null; // { iceServers: [...], expiresAt: number }

async function fetchMeteredServers(apiKey) {
  if (_meteredCache && Date.now() < _meteredCache.expiresAt) {
    return _meteredCache.iceServers;
  }
  const url = `https://global.relay.metered.ca/api/v1/turn/credentials?apiKey=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
  if (!res.ok) throw new Error(`Metered API ${res.status}`);
  const servers = await res.json();
  _meteredCache = { iceServers: servers, expiresAt: Date.now() + 60 * 60 * 1000 };
  console.log(`[ICE] Fetched ${servers.length} Metered TURN servers (cached 1 h)`);
  return servers;
}

router.get('/ice-servers', authMiddleware, async (req, res) => {
  const stunServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];

  // ── Path 1: HMAC local generation (no network call, always fresh) ─────────
  const turnSecret = process.env.METERED_TURN_SECRET;
  const rawUrls = process.env.TURN_URLS
    ? process.env.TURN_URLS.split(',').map(s => s.trim()).filter(Boolean)
    : process.env.TURN_URL ? [process.env.TURN_URL] : [];

  if (turnSecret && rawUrls.length) {
    const { username, credential } = generateHmacCredentials(turnSecret);
    const iceServers = [
      ...stunServers,
      ...rawUrls.map(url => ({ urls: url, username, credential })),
    ];
    console.log(`[ICE] HMAC credentials generated (expires in 24 h), ${iceServers.length} servers`);
    return res.json({ iceServers });
  }

  // ── Path 2: Metered REST API ──────────────────────────────────────────────
  const meteredApiKey = process.env.METERED_API_KEY;
  if (meteredApiKey) {
    try {
      const meteredServers = await fetchMeteredServers(meteredApiKey);
      return res.json({ iceServers: [...stunServers, ...meteredServers] });
    } catch (err) {
      console.error('[ICE] Metered API failed, falling back to static config:', err.message);
    }
  }

  // ── Path 3: Static credentials (fallback — expire every 24 h) ────────────
  const iceServers = [...stunServers];
  const turnUsername   = process.env.TURN_USERNAME;
  const turnCredential = process.env.TURN_CREDENTIAL;

  if (rawUrls.length && turnUsername && turnCredential) {
    for (const url of rawUrls) {
      iceServers.push({ urls: url, username: turnUsername, credential: turnCredential });
    }
  }

  console.log(`[ICE] Static credentials, ${iceServers.length} servers (${rawUrls.length} TURN)`);
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
