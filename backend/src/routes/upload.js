const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { v4: uuidv4 } = require('uuid');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { createPresignedPost } = require('@aws-sdk/s3-presigned-post');
const { authMiddleware } = require('../middleware/auth');
const logger = require('../utils/logger');
const sharp = require('sharp');

// Opt-in: when true, /upload/presign returns a presigned POST policy instead of
// a presigned PUT URL. POST is the only browser-upload mechanism that can bind
// the maximum object size at the storage level (content-length-range) — a PUT
// presign cannot, and images/videos are compressed client-side AFTER presign so
// an exact Content-Length can't be signed either. Gated behind an env flag so it
// stays INERT until the operator (a) adds POST to the bucket CORS policy and
// (b) flips this flag — flipping it off is an instant rollback to PUT with no
// redeploy. See DEPLOY notes / the upload-security section.
const USE_PRESIGN_POST = process.env.UPLOAD_PRESIGN_POST === 'true';

const router = express.Router();
router.use(authMiddleware);

const {
  IMAGE_TYPES, AUDIO_TYPES, VIDEO_TYPES, DOCUMENT_TYPES,
  ALLOWED_TYPES, MIME_TO_EXT,
  MAX_DIRECT_SIZE, MAX_PRESIGN_SIZE,
} = require('../utils/allowedMimeTypes');

// GIF passes through unchanged (animated GIF would break if re-encoded).
// All other image types → WebP at quality 82, max 2560px.
async function compressImage(buffer, mime) {
  if (mime === 'image/gif') return { buffer, mime, ext: '.gif' };
  const compressed = await sharp(buffer)
    .rotate()
    .resize({ width: 2560, height: 2560, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();
  return { buffer: compressed, mime: 'image/webp', ext: '.webp' };
}

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
  logger.info('[Upload]', 'Using Yandex Cloud Object Storage', {});
} else {
  logger.info('[Upload]', 'Using local disk storage', {});
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_DIRECT_SIZE } });

// POST /upload — direct upload through server (used in local disk mode or as fallback)
router.post('/', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided' });

  // Normalize audio MIME — strip codec params ("audio/webm;codecs=opus" → "audio/webm")
  let mime = req.file.mimetype.startsWith('audio/')
    ? req.file.mimetype.split(';')[0]
    : req.file.mimetype;

  // Explicit allowlist check — same rules as /upload/presign
  if (!ALLOWED_TYPES.has(mime)) {
    return res.status(400).json({ error: 'File type not allowed' });
  }

  const type = IMAGE_TYPES.includes(mime) ? 'image'
             : VIDEO_TYPES.includes(mime) ? 'video'
             : AUDIO_TYPES.includes(mime) ? 'audio'
             : 'file';

  let ext = MIME_TO_EXT[mime] || '';

  // Multer decodes filenames as latin1 — re-encode to get UTF-8
  const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');

  // Compress images before storing
  if (type === 'image') {
    try {
      const result = await compressImage(req.file.buffer, mime);
      req.file.buffer = result.buffer;
      mime             = result.mime;
      ext              = result.ext;
    } catch (err) {
      logger.error('[Upload]', 'Image compression failed', err, {});
      return res.status(500).json({ error: 'Image processing failed: ' + err.message });
    }
  }

  const filename = `${uuidv4()}${ext}`;
  const size = req.file.buffer.length;

  // Inline only for image and video — audio and documents always get attachment
  const contentDisposition = (type === 'image' || type === 'video')
    ? 'inline'
    : `attachment; filename*=UTF-8''${encodeURIComponent(originalName)}`;

  if (useS3) {
    try {
      await s3.send(new PutObjectCommand({
        Bucket: process.env.S3_BUCKET, Key: filename,
        Body: req.file.buffer, ContentType: mime,
        ContentDisposition: contentDisposition,
      }));
      const publicUrl = process.env.S3_PUBLIC_URL.replace(/\/+$/, '');
      res.json({ url: `${publicUrl}/${filename}`, type, name: originalName, size });
    } catch (err) {
      logger.error('[Upload]', 'S3 upload failed', err, {});
      res.status(500).json({ error: 'Upload failed: ' + err.message });
    }
  } else {
    const uploadDir = path.join(__dirname, '../../uploads');
    await fs.promises.mkdir(uploadDir, { recursive: true });
    await fs.promises.writeFile(path.join(uploadDir, filename), req.file.buffer);
    res.json({ url: `/uploads/${filename}`, type, name: originalName, size });
  }
});

// POST /upload/presign — returns a presigned PUT URL for direct S3 upload
// Body: { mime, size, filename }
router.post('/presign', async (req, res, next) => {
  try {
    if (!useS3) return res.json({ fallback: true });

    const { size, filename: origName } = req.body;
    // Strip codec params from audio; fall back to octet-stream when browser omits type
    const rawMime = (req.body.mime || '').trim();
    const mime = rawMime.startsWith('audio/')
      ? rawMime.split(';')[0]
      : (rawMime || 'application/octet-stream');

    const sizeNum = Number(size) || 0;
    if (sizeNum > MAX_PRESIGN_SIZE) {
      return res.status(400).json({ error: `File too large (max ${MAX_PRESIGN_SIZE / 1024 / 1024}MB)` });
    }

    // Same allowlist as POST /upload
    if (!ALLOWED_TYPES.has(mime)) {
      return res.status(400).json({ error: 'File type not allowed' });
    }

    const ext = MIME_TO_EXT[mime] || '';
    const key = `${uuidv4()}${ext}`;
    const publicUrl = process.env.S3_PUBLIC_URL.replace(/\/+$/, '');
    const fileUrl = `${publicUrl}/${key}`;

    // Inline only for image and video — audio and documents always get attachment.
    // (Serving safety is also enforced at GET time via s3Sign overrides, so this
    // stored disposition is belt-and-suspenders.)
    const isInline = mime.startsWith('image/') || mime.startsWith('video/');
    const contentDisposition = isInline
      ? 'inline'
      : `attachment; filename*=UTF-8''${encodeURIComponent(origName || key)}`;

    // ── Presigned POST (opt-in) ──────────────────────────────────────────────
    // Binds the maximum object size at the storage layer via content-length-range
    // — something a presigned PUT URL cannot do. Content-Type/Disposition use
    // permissive starts-with conditions (the client still sets them, and GET-time
    // overrides guarantee safe serving), avoiding eq-mismatch upload failures when
    // client-side compression slightly changes the type.
    if (USE_PRESIGN_POST) {
      const { url, fields } = await createPresignedPost(s3, {
        Bucket: process.env.S3_BUCKET,
        Key: key,
        Conditions: [
          ['content-length-range', 1, MAX_PRESIGN_SIZE],
          ['starts-with', '$Content-Type', ''],
          ['starts-with', '$Content-Disposition', ''],
        ],
        Fields: { 'Content-Type': mime, 'Content-Disposition': contentDisposition },
        Expires: 300,
      });
      return res.json({ method: 'POST', uploadUrl: url, fields, fileUrl, contentType: mime, contentDisposition });
    }

    // ── Presigned PUT (default) ──────────────────────────────────────────────
    // Note: ContentType and ContentDisposition are not included in the signed command
    // because Yandex Cloud rejects signed Content-Type headers during CORS preflight.
    // The allowlist check above is the server-side gate; the client sends the headers
    // in the PUT request and they are stored as S3 object metadata.
    const command = new PutObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: key,
    });

    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 });
    res.json({ method: 'PUT', uploadUrl, fileUrl, contentType: mime, contentDisposition });
  } catch (err) { next(err); }
});

module.exports = router;
