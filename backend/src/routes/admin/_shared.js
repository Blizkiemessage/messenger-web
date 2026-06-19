'use strict';

/**
 * routes/admin/_shared.js — helpers shared by admin sub-routers.
 * Kept in a separate file to avoid circular imports between admin.js and its
 * sub-routers (both need clientIp; the sub-routers cannot pull it from admin.js
 * because admin.js mounts them).
 */

function clientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || null;
}

module.exports = { clientIp };
