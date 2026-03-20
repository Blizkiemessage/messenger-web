const { verify } = require('../utils/jwt');
const { getDb } = require('../config/database');

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = header.slice(7);
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
  req.sessionId = payload.jti;
  next();
}

module.exports = { authMiddleware };
