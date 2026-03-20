const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif'];
const VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm', 'video/mov'];
const MAX_SIZE = 100 * 1024 * 1024; // 100 MB

// Use R2 when all required env vars are present, otherwise fall back to local disk
const useR2 = !!(
  process.env.R2_ACCOUNT_ID &&
  process.env.R2_ACCESS_KEY_ID &&
  process.env.R2_SECRET_ACCESS_KEY &&
  process.env.R2_BUCKET &&
  process.env.R2_PUBLIC_URL
);

let s3;
if (useR2) {
  s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
  console.log('[Upload] Using Cloudflare R2 storage');
} else {
  console.log('[Upload] Using local disk storage');
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE },
});

// POST /upload
router.post('/', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided' });

  const mime = req.file.mimetype;
  const type = IMAGE_TYPES.includes(mime) ? 'image' : VIDEO_TYPES.includes(mime) ? 'video' : 'file';
  const ext = path.extname(req.file.originalname) || '';
  const filename = `${uuidv4()}${ext}`;

  if (useR2) {
    try {
      await s3.send(new PutObjectCommand({
        Bucket: process.env.R2_BUCKET,
        Key: filename,
        Body: req.file.buffer,
        ContentType: mime,
      }));
      res.json({
        url: `${process.env.R2_PUBLIC_URL}/${filename}`,
        type,
        name: req.file.originalname,
      });
    } catch (err) {
      console.error('[Upload] R2 error:', err.message);
      res.status(500).json({ error: 'Upload failed' });
    }
  } else {
    // Local disk fallback for development
    const uploadDir = path.join(__dirname, '../../uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    fs.writeFileSync(path.join(uploadDir, filename), req.file.buffer);
    res.json({
      url: `/uploads/${filename}`,
      type,
      name: req.file.originalname,
    });
  }
});

module.exports = router;
