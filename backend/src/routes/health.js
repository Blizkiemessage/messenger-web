const { Router } = require('express');
const { getDb } = require('../config/database');

const router = Router();

router.get('/', (req, res) => {
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
