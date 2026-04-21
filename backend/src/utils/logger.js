/**
 * Minimal structured logger.
 * In production, replace console with a real logger (pino, winston) if needed.
 */

const isProd = process.env.NODE_ENV === 'production';

function info(tag, message, meta = {}) {
  console.log(JSON.stringify({ level: 'info', tag, message, ...meta, ts: Date.now() }));
}

function warn(tag, message, meta = {}) {
  console.warn(JSON.stringify({ level: 'warn', tag, message, ...meta, ts: Date.now() }));
}

function error(tag, message, err = null, meta = {}) {
  const entry = { level: 'error', tag, message, ...meta, ts: Date.now() };
  if (err) {
    entry.error = err.message;
    if (!isProd) entry.stack = err.stack;
  }
  console.error(JSON.stringify(entry));
}

module.exports = { info, warn, error };
