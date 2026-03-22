const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { v4: uuidv4 } = require('uuid');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

const IMAGE_TYPES = [
  'image/jpeg','image/png','image/gif','image/webp',
  'image/heic','image/heif','image/bmp','image/tiff','image/svg+xml',
];
const VIDEO_TYPES = [
  'video/mp4','video/quicktime','video/x-msvideo',
  'video/webm','video/mov','video/mpeg','video/x-matroska',
];
const MAX_SIZE = 100 * 1024 * 1024;

const useS3 = !!(
  process.env.S3_ACCESS_KEY_ID &&
  process.env.S3_SECRET_ACCESS_KEY &&
  process.env.S3_BUCKET &&
  process.env.S3_PUBLIC_URL
);

let s3;
if (useS3) {
  s3 = new S3Client({
    region:   process.env.S3_REGION || 'ru-central1',
    endpoint: process.env.S3_ENDPOINT || 'https://storage.yandexcloud.net',
    credentials: {
      accessKeyId:     process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    },
  });
  console.log('[Upload] Using Yandex Cloud Object Storage');
} else {
  console.log('[Upload] Using local disk storage');
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_SIZE } });

router.post('/', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided' });

  const mime = req.file.mimetype;
  const type = IMAGE_TYPES.includes(mime) ? 'image'
             : VIDEO_TYPES.includes(mime) ? 'video'
             : 'file';
  const ext = path.extname(req.file.originalname) || '';

  // ✅ FIX CYRILLIC: multer decodes filenames as latin1. Re-encode to get UTF-8.
  const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');

  const filename = `${uuidv4()}${ext}`;
  const size = req.file.size;

  if (useS3) {
    try {
      const contentDisposition = (type === 'image' || type === 'video')
        ? 'inline'
        : `attachment; filename*=UTF-8''${encodeURIComponent(originalName)}`;

      await s3.send(new PutObjectCommand({
        Bucket: process.env.S3_BUCKET, Key: filename,
        Body: req.file.buffer, ContentType: mime,
        ContentDisposition: contentDisposition,
      }));

      const publicUrl = process.env.S3_PUBLIC_URL.replace(/\/+$/, '');
      res.json({ url: `${publicUrl}/${filename}`, type, name: originalName, size });
    } catch (err) {
      console.error('[Upload] S3 error:', err.message);
      res.status(500).json({ error: 'Upload failed: ' + err.message });
    }
  } else {
    const uploadDir = path.join(__dirname, '../../uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    fs.writeFileSync(path.join(uploadDir, filename), req.file.buffer);
    res.json({ url: `/uploads/${filename}`, type, name: originalName, size });
  }
});

module.exports = router;
