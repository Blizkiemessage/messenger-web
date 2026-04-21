/**
 * Minimal structured logger.
 * Writes JSON to stdout/stderr and persists error/warn entries to app_errors table.
 * In production, replace console with a real logger (pino, winston) if needed.
 */

const isProd = process.env.NODE_ENV === 'production';
const MAX_STORED_ERRORS = 2000;

function _persist(level, tag, message, err, meta) {
  try {
    const db = require('../config/database').getDb();
    const userId = meta.userId || null;
    const metaCopy = { ...meta };
    delete metaCopy.userId;
    const metaStr = Object.keys(metaCopy).length ? JSON.stringify(metaCopy) : null;
    db.prepare(
      'INSERT INTO app_errors (level, tag, message, error_text, stack, meta, user_id, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run([
      level,
      tag || null,
      message || null,
      err?.message || null,
      (!isProd && err?.stack) ? err.stack : null,
      metaStr,
      userId,
      Date.now(),
    ]);
    // Prune oldest entries beyond the cap
    db.prepare(
      'DELETE FROM app_errors WHERE id NOT IN (SELECT id FROM app_errors ORDER BY ts DESC LIMIT ?)'
    ).run([MAX_STORED_ERRORS]);
  } catch { /* DB not ready yet — don't break the logger */ }
}

function info(tag, message, meta = {}) {
  console.log(JSON.stringify({ level: 'info', tag, message, ...meta, ts: Date.now() }));
}

function warn(tag, message, meta = {}) {
  console.warn(JSON.stringify({ level: 'warn', tag, message, ...meta, ts: Date.now() }));
  _persist('warn', tag, message, null, meta);
}

function error(tag, message, err = null, meta = {}) {
  const entry = { level: 'error', tag, message, ...meta, ts: Date.now() };
  if (err) {
    entry.error = err.message;
    if (!isProd) entry.stack = err.stack;
  }
  console.error(JSON.stringify(entry));
  _persist('error', tag, message, err, meta);
}

module.exports = { info, warn, error };
