function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  console.error('[ERROR]', status, err.message, err.stack);
  // Don't expose internal error details (stack traces, SQL) to clients
  const message = status < 500 ? (err.message || 'Request failed') : 'Internal server error';
  res.status(status).json({ error: message });
}

module.exports = { errorHandler };
