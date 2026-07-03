const { Router } = require('express');
const { getDb } = require('../config/database');
const { checkS3Health } = require('../utils/s3Sign');

const router = Router();

router.get('/', async (req, res) => {
  // Return 503 during graceful shutdown so UptimeRobot detects it immediately
  if (req.app.locals.isShuttingDown) {
    return res.status(503).json({
      status: 'shutting_down',
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
      db: 'closing',
    });
  }

  // S3 being degraded doesn't mean the whole app is down (uploads/backups fail,
  // but chats/auth/etc keep working) — reported alongside `db`, not folded into
  // the overall HTTP status, so an S3 blip doesn't trigger false-positive
  // "app is down" alerts on top of the real "uploads are broken" signal.
  const s3 = await checkS3Health();

  try {
    const db = getDb();
    db.prepare('SELECT 1').get();
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
      db: 'ok',
      s3,
    });
  } catch (err) {
    res.status(503).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
      db: 'unavailable',
      s3,
    });
  }
});

module.exports = router;
