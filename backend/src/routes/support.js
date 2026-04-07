const express = require('express');
const multer = require('multer');
const { randomUUID } = require('crypto');
const { authMiddleware } = require('../middleware/auth');
const { getUserById } = require('../services/userService');
const { sendSupportEmail } = require('../config/email');
const { getDb } = require('../config/database');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_, file, cb) => {
    cb(null, file.mimetype.startsWith('image/'));
  },
});

router.post('/', authMiddleware, upload.single('image'), async (req, res, next) => {
  try {
    const { subject, description } = req.body;
    if (!subject || !description) {
      return res.status(400).json({ error: 'Missing fields' });
    }

    const user = getUserById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const now = Date.now();
    const sentAt = new Date(now).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });

    // Determine type from subject prefix
    const type = subject.startsWith('Предложение') ? 'feature' : 'bug';

    // Save to DB for admin stats
    getDb().prepare(
      'INSERT INTO support_reports (id, type, username, user_email, subject, description, has_image, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run([randomUUID(), type, user.username, user.email || null, subject, description, req.file ? 1 : 0, now]);

    await sendSupportEmail({
      subject,
      username: user.username,
      userEmail: user.email || '—',
      sentAt,
      description,
      imageBuffer:   req.file?.buffer,
      imageFilename: req.file?.originalname,
      imageMimeType: req.file?.mimetype,
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
