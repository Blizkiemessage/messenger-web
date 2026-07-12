const logger = require('../utils/logger');
const { captureException } = require('../utils/sentry');

function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  if (status >= 500) {
    logger.error('[HTTP]', `${req.method} ${req.path} → ${status}`, err, {
      method: req.method,
      path: req.path,
      userId: req.userId || null,
    });
    captureException(err, { userId: req.userId || null });
  }
  // Don't expose internal error details (stack traces, SQL) to clients
  const message = status < 500 ? (err.message || 'Request failed') : 'Internal server error';
  res.status(status).json({ error: message });
}

module.exports = { errorHandler };
