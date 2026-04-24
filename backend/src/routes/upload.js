const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { v4: uuidv4 } = require('uuid');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { authMiddleware } = require('../middleware/auth');
const sharp = require('sharp');

const router = express.Router();
router.use(authMiddleware);

// ── Shared MIME allowlists ────────────────────────────────────────────────────
// image/svg+xml excluded: XSS vector (SVG can embed scripts).
// text/html excluded: XSS vector.
// application/octet-stream kept only as a browser fallback: some browsers
// (notably on Windows) report no MIME type for drag-dropped or pasted files.
// It must never be treated as "any binary is fine" — just as "unknown, allow through".
const IMAGE_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'image/heic', 'image/heif', 'image/bmp', 'image/tiff',
];
const AUDIO_TYPES = [
  'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg',
  'audio/wav', 'audio/aac', 'audio/flac', 'audio/x-m4a',
];
const VIDEO_TYPES = [
  'video/mp4', 'video/quicktime', 'video/x-msvideo',
  'video/webm', 'video/mov', 'video/mpeg', 'video/x-matroska',
];
const DOCUMENT_TYPES = [
  // Office
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.presentation',
  // Text / code (text/html intentionally excluded)
  'text/plain', 'text/csv', 'text/markdown', 'text/rtf',
  'application/json', 'application/xml', 'text/xml',
  // Archives
  'application/zip', 'application/x-zip-compressed',
  'application/x-rar-compressed', 'application/vnd.rar',
  'application/x-7z-compressed',
  'application/x-tar', 'application/gzip', 'application/x-bzip2',
  // Browser fallback only — not a "normal" document type
  'application/octet-stream',
];

const ALLOWED_TYPES = new Set([...IMAGE_TYPES, ...VIDEO_TYPES, ...AUDIO_TYPES, ...DOCUMENT_TYPES]);

// Single source of truth: MIME → file extension.
// Used by both POST /upload and POST /upload/presign to guarantee alignment.
const MIME_TO_EXT = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif',
  'image/webp': '.webp', 'image/heic': '.heic', 'image/heif': '.heif',
  'image/bmp': '.bmp', 'image/tiff': '.tiff',
  'audio/webm': '.webm', 'audio/ogg': '.ogg', 'audio/mp4': '.m4a',
  'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'audio/aac': '.aac',
  'audio/flac': '.flac', 'audio/x-m4a': '.m4a',
  'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/x-msvideo': '.avi',
  'video/webm': '.webm', 'video/mov': '.mov', 'video/mpeg': '.mpeg',
  'video/x-matroska': '.mkv',
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.oasis.opendocument.text': '.odt',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.oasis.opendocument.spreadsheet': '.ods',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'application/vnd.oasis.opendocument.presentation': '.odp',
  'text/plain': '.txt', 'text/csv': '.csv', 'text/markdown': '.md', 'text/rtf': '.rtf',
  'application/json': '.json', 'application/xml': '.xml', 'text/xml': '.xml',
  'application/zip': '.zip', 'application/x-zip-compressed': '.zip',
  'application/x-rar-compressed': '.rar', 'application/vnd.rar': '.rar',
  'application/x-7z-compressed': '.7z',
  'application/x-tar': '.tar', 'application/gzip': '.gz', 'application/x-bzip2': '.bz2',
};

// Direct upload goes through server memory → lower limit.
// Presign goes client→S3 directly; MAX_PRESIGN_SIZE is just a size-hint check.
const MAX_DIRECT_SIZE  = 50  * 1024 * 1024;
const MAX_PRESIGN_SIZE = 100 * 1024 * 1024;

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
  console.log('[Upload] Using Yandex Cloud Object Storage');
} else {
  console.log('[Upload] Using local disk storage');
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
      console.error('[Upload] Compression error:', err.message);
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
      console.error('[Upload] S3 error:', err.message);
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

    // Inline only for image and video — audio and documents always get attachment
    const isInline = mime.startsWith('image/') || mime.startsWith('video/');
    const contentDisposition = isInline
      ? 'inline'
      : `attachment; filename*=UTF-8''${encodeURIComponent(origName || key)}`;

    // Note: ContentType and ContentDisposition are not included in the signed command
    // because Yandex Cloud rejects signed Content-Type headers during CORS preflight.
    // The allowlist check above is the server-side gate; the client sends the headers
    // in the PUT request and they are stored as S3 object metadata.
    const command = new PutObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: key,
    });

    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 });
    const publicUrl = process.env.S3_PUBLIC_URL.replace(/\/+$/, '');
    res.json({ uploadUrl, fileUrl: `${publicUrl}/${key}`, contentType: mime, contentDisposition });
  } catch (err) { next(err); }
});

module.exports = router;
