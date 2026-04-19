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

const IMAGE_TYPES = [
  'image/jpeg','image/png','image/gif','image/webp',
  'image/heic','image/heif','image/bmp','image/tiff','image/svg+xml',
];
const AUDIO_TYPES = [
  'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg',
  'audio/wav', 'audio/aac', 'audio/flac', 'audio/x-m4a',
];
const VIDEO_TYPES = [
  'video/mp4','video/quicktime','video/x-msvideo',
  'video/webm','video/mov','video/mpeg','video/x-matroska',
];
const DOCUMENT_TYPES = [
  // Office documents
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
  // Text / code
  'text/plain', 'text/csv', 'text/markdown', 'text/html', 'text/rtf',
  'application/json', 'application/xml', 'text/xml',
  // Archives
  'application/zip', 'application/x-zip-compressed',
  'application/x-rar-compressed', 'application/vnd.rar',
  'application/x-7z-compressed',
  'application/x-tar', 'application/gzip', 'application/x-bzip2',
  // Generic binary fallback
  'application/octet-stream',
];
const MAX_SIZE = 100 * 1024 * 1024;

// GIF (may be animated) and SVG (already tiny text) pass through unchanged.
// All other image types are converted to WebP at quality 82, max 2560px on any side.
async function compressImage(buffer, mime) {
  if (mime === 'image/gif' || mime === 'image/svg+xml') {
    const ext = mime === 'image/gif' ? '.gif' : '.svg';
    return { buffer, mime, ext };
  }
  const compressed = await sharp(buffer)
    .rotate()                        // auto-orient from EXIF (fixes sideways phone photos)
    .resize({
      width:              2560,
      height:             2560,
      fit:                'inside',  // preserve aspect ratio, no crop, no padding
      withoutEnlargement: true,      // never upscale small images
    })
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

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_SIZE } });

router.post('/', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided' });

  // Normalize audio MIME — strip codec params (e.g. "audio/webm;codecs=opus" → "audio/webm")
  let mime = req.file.mimetype.startsWith('audio/') ? req.file.mimetype.split(';')[0] : req.file.mimetype;
  const type = IMAGE_TYPES.includes(mime) ? 'image'
             : VIDEO_TYPES.includes(mime) ? 'video'
             : AUDIO_TYPES.includes(mime) ? 'audio'
             : 'file';

  // Derive extension from MIME type — never trust client-supplied filename extension
  const MIME_TO_EXT = {
    'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif',
    'image/webp': '.webp', 'image/heic': '.heic', 'image/heif': '.heif',
    'image/bmp': '.bmp', 'image/tiff': '.tiff', 'image/svg+xml': '.svg',
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
    'text/plain': '.txt', 'text/csv': '.csv', 'text/markdown': '.md',
    'text/html': '.html', 'text/rtf': '.rtf',
    'application/json': '.json', 'application/xml': '.xml', 'text/xml': '.xml',
    'application/zip': '.zip', 'application/x-zip-compressed': '.zip',
    'application/x-rar-compressed': '.rar', 'application/vnd.rar': '.rar',
    'application/x-7z-compressed': '.7z',
    'application/x-tar': '.tar', 'application/gzip': '.gz', 'application/x-bzip2': '.bz2',
  };
  let ext = MIME_TO_EXT[mime] || '';

  // ✅ FIX CYRILLIC: multer decodes filenames as latin1. Re-encode to get UTF-8.
  const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');

  // ── Image compression ──────────────────────────────────────────────────────
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
  // ──────────────────────────────────────────────────────────────────────────

  const filename = `${uuidv4()}${ext}`;
  const size = req.file.buffer.length;

  if (useS3) {
    try {
      const contentDisposition = (type === 'image' || type === 'video')
        ? 'inline'
        : `attachment; filename*=UTF-8''${encodeURIComponent(originalName)}`;

      await s3.send(new PutObjectCommand({
        Bucket: process.env.S3_BUCKET, Key: filename,
        Body: req.file.buffer, ContentType: mime,
        ContentDisposition: contentDisposition,
        // ACL omitted — objects are private by default (bucket policy)
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

// POST /upload/presign — returns a presigned PUT URL for direct S3 upload
// Body: { mime, size, filename }  (mime is already the final upload mime, e.g. image/webp after client compression)
router.post('/presign', async (req, res, next) => {
  try {
    if (!useS3) return res.json({ fallback: true });

    const { size, filename: origName } = req.body;
    // Normalize MIME: strip codec params from audio ("audio/webm;codecs=opus" → "audio/webm"),
    // fall back to application/octet-stream when browser doesn't report a type (common on Windows)
    const rawMime = (req.body.mime || '').trim();
    const mime = rawMime.startsWith('audio/')
      ? rawMime.split(';')[0]
      : (rawMime || 'application/octet-stream');
    if (!size) return res.status(400).json({ error: 'size required' });
    if (size > MAX_SIZE) return res.status(400).json({ error: 'File too large (max 100MB)' });

    const ALLOWED = [...IMAGE_TYPES, ...VIDEO_TYPES, ...AUDIO_TYPES, ...DOCUMENT_TYPES];
    if (!ALLOWED.includes(mime)) return res.status(400).json({ error: 'File type not allowed' });

    const MIME_TO_EXT = {
      'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif',
      'image/webp': '.webp', 'image/heic': '.heic', 'image/heif': '.heif',
      'image/bmp': '.bmp', 'image/tiff': '.tiff', 'image/svg+xml': '.svg',
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
      'text/plain': '.txt', 'text/csv': '.csv', 'text/markdown': '.md',
      'text/html': '.html', 'text/rtf': '.rtf',
      'application/json': '.json', 'application/xml': '.xml', 'text/xml': '.xml',
      'application/zip': '.zip', 'application/x-zip-compressed': '.zip',
      'application/x-rar-compressed': '.rar', 'application/vnd.rar': '.rar',
      'application/x-7z-compressed': '.7z',
      'application/x-tar': '.tar', 'application/gzip': '.gz', 'application/x-bzip2': '.bz2',
    };

    const ext = MIME_TO_EXT[mime] || '';
    const key = `${uuidv4()}${ext}`;
    const isInline = mime.startsWith('image/') || mime.startsWith('video/');
    const contentDisposition = isInline
      ? 'inline'
      : `attachment; filename*=UTF-8''${encodeURIComponent(origName || key)}`;

    // ContentType and ContentDisposition are NOT signed — client sends them freely.
    // Signing ContentType forces the client to send a matching header, which some
    // S3-compatible providers (Yandex Cloud) reject during CORS preflight.
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
