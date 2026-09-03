const { verify } = require('../utils/jwt');
const { getDb } = require('../config/database');

// Bearer identifies THIS specific tab/client — always prefer it when present.
// The httpOnly cookie is shared by the whole browser profile (one cookie per
// host, independent of port or tab), so if a *different* login happened more
// recently in another tab, the cookie silently belongs to that other account
// and would otherwise override the tab's own in-memory access token
// (web/src/storage/session.ts). That mismatch made the admin panel unusable
// while any regular user was logged in elsewhere in the same browser, and let
// one tab's action be recorded under another tab's identity.
// Cookie stays as a fallback for requests that cannot carry a header
// (a bare <img>/<a> navigation, a first socket handshake before refresh).
function extractToken(req) {
  const bearer = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : null;
  return bearer || req.cookies?.session || null;
}

function authMiddleware(req, res, next) {
  const token = extractToken(req);

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  let payload;
  try {
    payload = verify(token);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  // Check session is not revoked
  const db = getDb();
  const session = db
    .prepare('SELECT id, revoked FROM sessions WHERE id = ?')
    .get(payload.jti);

  if (!session || session.revoked) {
    return res.status(401).json({ error: 'Session revoked' });
  }

  req.userId = payload.sub;
  req.user = { id: payload.sub }; // alias used by sticker-packs routes
  req.sessionId = payload.jti;

  // Update last_used_at (non-blocking)
  try {
    db.prepare('UPDATE sessions SET last_used_at = ? WHERE id = ?').run([Date.now(), payload.jti]);
  } catch { /* ignore */ }

  next();
}

module.exports = { authMiddleware, extractToken };
