const jwt = require('jsonwebtoken');

const SECRET = () => {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not set');
  return process.env.JWT_SECRET;
};

/**
 * Generic sign — used for short-lived purpose tokens (totp_pending, etc.)
 * Always pass `expiresIn` explicitly via options.
 */
function sign(payload, options = {}) {
  return jwt.sign(payload, SECRET(), { algorithm: 'HS256', ...options });
}

/** Access token — 15 minutes. Used for API/socket authentication. */
function signAccess(payload) {
  return jwt.sign(payload, SECRET(), { algorithm: 'HS256', expiresIn: '15m' });
}

/** Refresh token — 30 days. Used only at POST /auth/refresh to obtain a new access token. */
function signRefresh(payload) {
  return jwt.sign(payload, SECRET(), { algorithm: 'HS256', expiresIn: '30d' });
}

function verify(token) {
  return jwt.verify(token, SECRET(), { algorithms: ['HS256'] });
}

module.exports = { sign, signAccess, signRefresh, verify };
