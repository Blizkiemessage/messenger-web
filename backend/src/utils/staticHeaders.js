const path = require('path');

// User-uploaded files served from our own origin must never be sniffed or
// rendered inline as active content (e.g. an uploaded .html/.svg used for XSS
// or phishing on a trusted domain). Always send nosniff; serve only real media
// inline (mirrors the presign disposition logic in utils/s3Sign.js), force
// download for everything else.
// NB: production uses S3 — the /uploads static path is the local-disk fallback.
const INLINE_EXT = new Set([
  '.webp', '.jpg', '.jpeg', '.png', '.gif', '.mp4', '.webm', '.mov',
]);

/**
 * express.static `setHeaders` hook for /uploads. Exported separately from
 * index.js (which cannot be required in tests — it boots a real server) so the
 * exact headers shipped in production stay covered by tests, the same way
 * s3Sign's safeServeOverrides and messages.js's attachmentExceedsLimit are.
 */
function setUploadHeaders(res, filePath) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Allow this resource to be embedded (<img>/<video>/<audio>) from another
  // origin — the frontend and backend always live on different origins in this
  // project (Vercel ↔ Amvera in production, :5173 ↔ :3000 in dev). CORS already
  // permits the request (corsOriginCallback), but CORP is a separate, stricter
  // browser check, and helmet()'s global default of `same-origin` blocks
  // cross-origin embedding regardless of CORS — so without this every image /
  // video / voice message rendered as a broken file card
  // (ERR_BLOCKED_BY_RESPONSE.NotSameOrigin) on any deployment that falls back
  // to local-disk storage. Same reasoning as crossOriginEmbedderPolicy being
  // disabled in index.js for S3 media playback.
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  if (!INLINE_EXT.has(path.extname(filePath).toLowerCase())) {
    res.setHeader('Content-Disposition', 'attachment');
  }
}

module.exports = { setUploadHeaders, INLINE_EXT };
