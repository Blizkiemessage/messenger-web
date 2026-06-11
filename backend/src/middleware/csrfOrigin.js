'use strict';

/**
 * csrfOrigin.js — defence-in-depth against CSRF.
 *
 * Cookies are issued with SameSite=None in production (required for the
 * cross-origin Vercel→Amvera split), so the browser attaches the session
 * cookie to cross-site requests. CORS already forces a preflight on JSON
 * requests, but this middleware adds an explicit server-side Origin check
 * on every state-changing request as a second, independent gate.
 *
 * Policy (only for unsafe methods POST/PUT/PATCH/DELETE):
 *   - Same-origin request (Origin host === Host header) → allow.
 *   - Origin in the CORS allowlist (isAllowedOrigin) → allow.
 *   - No Origin AND no Referer → allow (non-browser client using a Bearer
 *     token; browsers always send Origin on unsafe cross-origin requests).
 *   - Otherwise → 403.
 *
 * Safe methods (GET/HEAD/OPTIONS) are never blocked.
 */

const { isAllowedOrigin } = require('../utils/corsOrigin');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Extract the origin ("scheme://host[:port]") from a full URL, or null. */
function originOf(url) {
  try { return new URL(url).origin; } catch { return null; }
}

/** True when `origin` points at the same host the request was sent to. */
function isSameOrigin(origin, req) {
  const host = req.headers.host;
  if (!host || !origin) return false;
  try { return new URL(origin).host === host; } catch { return false; }
}

function csrfOrigin(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();

  // Prefer Origin; fall back to Referer (some browsers omit Origin on same-site).
  const origin = req.headers.origin || originOf(req.headers.referer || '');

  // No browser-supplied origin at all → treat as a non-browser API client.
  // Such clients cannot be victims of CSRF (no ambient cookies), so allow.
  if (!origin) return next();

  if (isSameOrigin(origin, req) || isAllowedOrigin(origin)) return next();

  return res.status(403).json({ error: 'Cross-origin request blocked' });
}

module.exports = { csrfOrigin };
