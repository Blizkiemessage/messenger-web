const express = require('express');
const multer = require('multer');
const { authMiddleware } = require('../middleware/auth');
const { getUserById } = require('../services/userService');
const { sendSupportEmail } = require('../config/email');

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

    const sentAt = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });

    await sendSupportEmail({
      subject,
      username: user.username,
      userEmail: user.email || '—',
      sentAt,
      description,
      imageBuffer: req.file?.buffer,
      imageFilename: req.file?.originalname,
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
