const { Router } = require('express');
const { getDb } = require('../config/database');

const router = Router();

router.get('/', (req, res) => {
  // Return 503 during graceful shutdown so UptimeRobot detects it immediately
  if (req.app.locals.isShuttingDown) {
    return res.status(503).json({
      status: 'shutting_down',
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
      db: 'closing',
    });
  }

  try {
    const db = getDb();
    db.prepare('SELECT 1').get();
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
      db: 'ok',
    });
  } catch (err) {
    res.status(503).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
      db: 'unavailable',
    });
  }
});

module.exports = router;
