'use strict';

/**
 * Shared CORS origin check used by both HTTP (express-cors) and Socket.IO.
 * Keeping both in one place ensures they never drift apart.
 *
 * Allowed:
 *   - No origin header (non-browser clients: curl, mobile native, etc.)
 *   - localhost / 127.0.0.1 on any port
 *   - Private LAN ranges: 10.x, 192.168.x, 172.16-31.x
 *   - process.env.APP_URL       (exact match)
 *   - process.env.ALLOWED_ORIGIN (exact match)
 *
 * Intentionally NOT allowed:
 *   - Wildcard *.vercel.app — too broad; any Vercel project could call the API.
 */

const LAN_RE = [
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  /^https?:\/\/10\.\d+\.\d+\.\d+(:\d+)?$/,
  /^https?:\/\/192\.168\.\d+\.\d+(:\d+)?$/,
  /^https?:\/\/172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+(:\d+)?$/,
];

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (LAN_RE.some(re => re.test(origin))) return true;

  const appUrl = (process.env.APP_URL || '').replace(/\/+$/, '');
  if (appUrl && origin === appUrl) return true;

  // ALLOWED_ORIGIN may be a comma-separated list of exact origins
  const allowedRaw = process.env.ALLOWED_ORIGIN || '';
  const allowedList = allowedRaw.split(',').map(s => s.trim().replace(/\/+$/, '')).filter(Boolean);
  if (allowedList.some(a => a === origin)) return true;

  return false;
}

function corsOriginCallback(origin, cb) {
  if (isAllowedOrigin(origin)) return cb(null, true);
  return cb(new Error(`CORS blocked: ${origin}`));
}

module.exports = { isAllowedOrigin, corsOriginCallback };
