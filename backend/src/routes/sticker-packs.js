const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { v4: uuidv4 } = require('uuid');
const sharp   = require('sharp');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { authMiddleware } = require('../middleware/auth');
const { getDb } = require('../config/database');

const router = express.Router();
router.use(authMiddleware);

// ── S3 / local storage (same pattern as upload.js) ──────────────────────────
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
}

const MIME_EXT = {
  'image/gif': '.gif', 'image/apng': '.apng', 'image/png': '.png',
  'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/webp': '.webp',
  'image/svg+xml': '.svg', 'image/avif': '.avif', 'image/bmp': '.bmp',
  'image/tiff': '.tiff', 'image/heic': '.heic', 'image/heif': '.heif',
  'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov',
  'video/x-msvideo': '.avi', 'video/mpeg': '.mpeg', 'video/3gpp': '.3gp',
};

async function saveFile(buffer, mime, prefix) {
  const ext = MIME_EXT[mime] || '.bin';
  const filename = `${prefix}-${uuidv4()}${ext}`;

  if (useS3) {
    await s3.send(new PutObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key:    filename,
      Body:   buffer,
      ContentType: mime,
      ContentDisposition: 'inline',
      ACL: 'public-read',
    }));
    const publicUrl = process.env.S3_PUBLIC_URL.replace(/\/+$/, '');
    return `${publicUrl}/${filename}`;
  } else {
    const uploadDir = path.join(__dirname, '../../uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    fs.writeFileSync(path.join(uploadDir, filename), buffer);
    return `/uploads/${filename}`;
  }
}

// ── Multer: memory storage, 50 MB limit, all sticker-compatible formats ──────
const STICKER_TYPES = [
  // Raster static
  'image/png', 'image/jpeg', 'image/jpg', 'image/webp',
  'image/bmp', 'image/tiff', 'image/avif', 'image/heic', 'image/heif',
  // Animated raster
  'image/gif', 'image/apng',
  // Vector
  'image/svg+xml',
  // Video
  'video/mp4', 'video/webm', 'video/quicktime',
  'video/x-msvideo', 'video/mpeg', 'video/3gpp',
];
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    cb(null, STICKER_TYPES.includes(file.mimetype));
  },
});

// ── Quota helpers ────────────────────────────────────────────────────────────
function getOrCreateQuota(db, userId) {
  let q = db.prepare('SELECT * FROM user_creation_quota WHERE user_id = ?').get([userId]);
  if (!q) {
    db.prepare(`INSERT INTO user_creation_quota (user_id, packs_created, gifs_created,
      free_packs_limit, free_gifs_limit, extra_packs, extra_gifs)
      VALUES (?, 0, 0, 3, 10, 0, 0)`).run([userId]);
    q = db.prepare('SELECT * FROM user_creation_quota WHERE user_id = ?').get([userId]);
  }
  return q;
}

// ── Row mappers ──────────────────────────────────────────────────────────────
function mapPack(r) {
  return { ...r, is_public: !!r.is_public, is_animated: !!r.is_animated, is_deleted: !!r.is_deleted };
}
function mapItem(r) {
  return {
    ...r,
    keywords: r.keywords ? JSON.parse(r.keywords) : null,
  };
}

// ────────────────────────────────────────────────────────────────────────────
//  BROWSE / INSTALL ROUTES
// ────────────────────────────────────────────────────────────────────────────

// GET /sticker-packs/installed — user's installed packs ordered by sort_order
router.get('/installed', (req, res) => {
  const db = getDb();
  try {
    const rows = db.prepare(`
      SELECT sp.*, usp.sort_order AS user_sort_order, usp.installed_at
      FROM sticker_packs sp
      JOIN user_sticker_packs usp ON usp.pack_id = sp.id
      WHERE usp.user_id = ? AND sp.is_deleted = 0
      ORDER BY usp.sort_order ASC, usp.installed_at ASC
    `).all([req.user.id]);
    res.json(rows.map(mapPack));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /sticker-packs/my — packs owned by user (for Studio)
router.get('/my', (req, res) => {
  const db = getDb();
  try {
    const rows = db.prepare(`
      SELECT sp.*,
        (SELECT COUNT(*) FROM sticker_pack_items WHERE pack_id = sp.id) AS item_count
      FROM sticker_packs sp
      WHERE sp.owner_id = ? AND sp.is_deleted = 0
      ORDER BY sp.created_at DESC
    `).all([req.user.id]);
    res.json(rows.map(mapPack));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /sticker-packs/browse?q=&limit=&offset=&type= — public packs discovery
router.get('/browse', (req, res) => {
  const db = getDb();
  const q      = String(req.query.q || '').trim();
  const limit  = Math.min(Math.max(parseInt(String(req.query.limit  || '20')), 1), 50);
  const offset = Math.max(parseInt(String(req.query.offset || '0')), 0);
  const type   = ['sticker', 'emoji'].includes(String(req.query.type || '')) ? String(req.query.type) : null;
  try {
    let baseWhere = `sp.is_public = 1 AND sp.is_deleted = 0`;
    if (type) baseWhere += ` AND sp.type = '${type}'`;

    const baseSelect = `
      SELECT sp.*,
        (SELECT COUNT(*) FROM sticker_pack_items WHERE pack_id = sp.id) AS item_count,
        EXISTS(SELECT 1 FROM user_sticker_packs WHERE user_id = ? AND pack_id = sp.id) AS is_installed
      FROM sticker_packs sp
      WHERE ${baseWhere}
    `;
    const rows = q
      ? db.prepare(`${baseSelect} AND (LOWER(sp.name) LIKE LOWER(?) OR LOWER(COALESCE(sp.description,'')) LIKE LOWER(?))
          ORDER BY sp.created_at DESC LIMIT ? OFFSET ?`
        ).all([req.user.id, `%${q}%`, `%${q}%`, limit, offset])
      : db.prepare(`${baseSelect} ORDER BY sp.created_at DESC LIMIT ? OFFSET ?`
        ).all([req.user.id, limit, offset]);

    res.json(rows.map(r => ({ ...mapPack(r), is_installed: !!r.is_installed })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /sticker-packs/:id — get single pack (public or owner)
router.get('/:id', (req, res) => {
  const db = getDb();
  try {
    const pack = db.prepare(`
      SELECT sp.*,
        (SELECT COUNT(*) FROM sticker_pack_items WHERE pack_id = sp.id) AS item_count,
        EXISTS(SELECT 1 FROM user_sticker_packs WHERE user_id = ? AND pack_id = sp.id) AS is_installed
      FROM sticker_packs sp
      WHERE sp.id = ? AND sp.is_deleted = 0
    `).get([req.user.id, req.params.id]);
    if (!pack) return res.status(404).json({ error: 'Not found' });
    if (!pack.is_public && pack.owner_id !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.json({ ...mapPack(pack), is_installed: !!pack.is_installed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /sticker-packs/:id/items — items for a pack
router.get('/:id/items', (req, res) => {
  const db = getDb();
  try {
    const pack = db.prepare('SELECT * FROM sticker_packs WHERE id = ? AND is_deleted = 0').get([req.params.id]);
    if (!pack) return res.status(404).json({ error: 'Pack not found' });

    // Non-owners can only see public packs or packs they have installed
    if (pack.owner_id !== req.user.id && !pack.is_public) {
      const installed = db.prepare(
        'SELECT 1 FROM user_sticker_packs WHERE user_id = ? AND pack_id = ?'
      ).get([req.user.id, req.params.id]);
      if (!installed) return res.status(403).json({ error: 'Forbidden' });
    }

    const items = db.prepare(
      'SELECT * FROM sticker_pack_items WHERE pack_id = ? ORDER BY sort_order ASC'
    ).all([req.params.id]);
    res.json(items.map(mapItem));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /sticker-packs/:id/install
router.post('/:id/install', (req, res) => {
  const db = getDb();
  try {
    const pack = db.prepare('SELECT * FROM sticker_packs WHERE id = ? AND is_deleted = 0 AND is_public = 1').get([req.params.id]);
    if (!pack) return res.status(404).json({ error: 'Pack not found or not public' });

    const maxOrder = db.prepare(
      'SELECT COALESCE(MAX(sort_order), -1) AS m FROM user_sticker_packs WHERE user_id = ?'
    ).get([req.user.id]).m;

    db.prepare(`INSERT OR IGNORE INTO user_sticker_packs (user_id, pack_id, installed_at, sort_order)
      VALUES (?, ?, ?, ?)`).run([req.user.id, req.params.id, Date.now(), maxOrder + 1]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /sticker-packs/:id/install
router.delete('/:id/install', (req, res) => {
  const db = getDb();
  try {
    db.prepare('DELETE FROM user_sticker_packs WHERE user_id = ? AND pack_id = ?')
      .run([req.user.id, req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /sticker-packs/installed/order — body: { ids: string[] }
router.patch('/installed/order', (req, res) => {
  const db = getDb();
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  try {
    const stmt = db.prepare(
      'UPDATE user_sticker_packs SET sort_order = ? WHERE user_id = ? AND pack_id = ?'
    );
    db.exec('BEGIN');
    try {
      ids.forEach((id, i) => stmt.run([i, req.user.id, id]));
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
//  STUDIO ROUTES (create / edit / delete packs + items)
// ────────────────────────────────────────────────────────────────────────────

// POST /sticker-packs — create new pack (checks quota)
router.post('/', (req, res) => {
  const db = getDb();
  const { name, description, type = 'sticker', is_public = false } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });

  try {
    const quota = getOrCreateQuota(db, req.user.id);
    const limit = quota.free_packs_limit + quota.extra_packs;
    if (quota.packs_created >= limit) {
      return res.status(403).json({ error: 'quota_exceeded', quota });
    }

    const id = uuidv4();
    const now = Date.now();
    db.prepare(`INSERT INTO sticker_packs
      (id, owner_id, type, name, description, is_public, is_animated, is_deleted, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`
    ).run([id, req.user.id, type, name.trim(), description?.trim() || null, is_public ? 1 : 0, now, now]);

    db.prepare('UPDATE user_creation_quota SET packs_created = packs_created + 1 WHERE user_id = ?')
      .run([req.user.id]);

    // Auto-install the new pack for its creator
    const maxOrder = db.prepare(
      'SELECT COALESCE(MAX(sort_order), -1) AS m FROM user_sticker_packs WHERE user_id = ?'
    ).get([req.user.id]).m;
    db.prepare('INSERT OR IGNORE INTO user_sticker_packs (user_id, pack_id, installed_at, sort_order) VALUES (?, ?, ?, ?)')
      .run([req.user.id, id, now, maxOrder + 1]);

    res.status(201).json(mapPack(db.prepare('SELECT * FROM sticker_packs WHERE id = ?').get([id])));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /sticker-packs/:id — edit pack metadata (owner only)
router.patch('/:id', (req, res) => {
  const db = getDb();
  try {
    const pack = db.prepare('SELECT * FROM sticker_packs WHERE id = ? AND is_deleted = 0').get([req.params.id]);
    if (!pack) return res.status(404).json({ error: 'Not found' });
    if (pack.owner_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

    const fields = [];
    const values = [];
    const allowed = ['name', 'description', 'is_public', 'cover_url'];
    for (const key of allowed) {
      if (req.body?.[key] !== undefined) {
        fields.push(`${key} = ?`);
        values.push(key === 'is_public' ? (req.body[key] ? 1 : 0) : req.body[key]);
      }
    }
    if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });

    fields.push('updated_at = ?');
    values.push(Date.now(), req.params.id);

    db.prepare(`UPDATE sticker_packs SET ${fields.join(', ')} WHERE id = ?`).run(values);
    res.json(mapPack(db.prepare('SELECT * FROM sticker_packs WHERE id = ?').get([req.params.id])));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /sticker-packs/:id/logo — upload pack logo (image/gif/video ≤5 s enforced client-side)
router.post('/:id/logo', upload.single('file'), async (req, res) => {
  const db = getDb();
  if (!req.file) return res.status(400).json({ error: 'No file or unsupported format' });
  try {
    const pack = db.prepare('SELECT * FROM sticker_packs WHERE id = ? AND is_deleted = 0').get([req.params.id]);
    if (!pack) return res.status(404).json({ error: 'Pack not found' });
    if (pack.owner_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

    const mime     = req.file.mimetype;
    const origname = (req.file.originalname || '').toLowerCase();
    const isVideo  = mime.startsWith('video/');
    const isSvg    = mime === 'image/svg+xml';
    const isGif    = mime === 'image/gif' || mime === 'image/apng'
      || origname.endsWith('.gif') || origname.endsWith('.apng');

    // Content-based animation fallback (handles wrong MIME from browser)
    let isContentAnimated = isGif;
    if (!isContentAnimated && !isVideo && !isSvg) {
      try {
        const meta = await sharp(req.file.buffer, { animated: true }).metadata();
        isContentAnimated = (meta.pages ?? 1) > 1;
      } catch { /* not detectable */ }
    }

    let fileBuffer, fileMime;
    if (isContentAnimated || isVideo || isSvg) {
      fileBuffer = req.file.buffer;
      fileMime   = mime;

      // GIF / APNG logo → animated WebP (smaller, same animation)
      const isGifOrApng = mime === 'image/gif' || mime === 'image/apng';
      if (isContentAnimated && isGifOrApng) {
        try {
          const compressed = await sharp(req.file.buffer, { animated: true })
            .webp({ quality: 85, effort: 4 })
            .toBuffer();
          if (compressed.length < fileBuffer.length) {
            fileBuffer = compressed;
            fileMime   = 'image/webp';
          }
        } catch { /* keep original */ }
      }
    } else {
      try {
        fileBuffer = await sharp(req.file.buffer)
          .resize({ width: 160, height: 160, fit: 'cover', position: 'centre' })
          .webp({ quality: 90 })
          .toBuffer();
        fileMime = 'image/webp';
      } catch {
        fileBuffer = req.file.buffer;
        fileMime   = mime;
      }
    }

    const logoUrl = await saveFile(fileBuffer, fileMime, 'pack-logo');
    db.prepare('UPDATE sticker_packs SET cover_url = ?, updated_at = ? WHERE id = ?')
      .run([logoUrl, Date.now(), req.params.id]);
    res.json({ cover_url: logoUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /sticker-packs/:id — soft delete (owner only)
router.delete('/:id', (req, res) => {
  const db = getDb();
  try {
    const pack = db.prepare('SELECT * FROM sticker_packs WHERE id = ? AND is_deleted = 0').get([req.params.id]);
    if (!pack) return res.status(404).json({ error: 'Not found' });
    if (pack.owner_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

    db.prepare('UPDATE sticker_packs SET is_deleted = 1, updated_at = ? WHERE id = ?')
      .run([Date.now(), req.params.id]);
    // Decrement quota counter so the user gets the slot back
    db.prepare(
      'UPDATE user_creation_quota SET packs_created = MAX(0, packs_created - 1) WHERE user_id = ?'
    ).run([req.user.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Items ────────────────────────────────────────────────────────────────────

// POST /sticker-packs/:id/items — upload sticker (multipart)
router.post('/:id/items', upload.single('file'), async (req, res) => {
  const db = getDb();
  if (!req.file) return res.status(400).json({ error: 'No file or unsupported format (use PNG, WebP, GIF)' });

  try {
    const pack = db.prepare('SELECT * FROM sticker_packs WHERE id = ? AND is_deleted = 0').get([req.params.id]);
    if (!pack) return res.status(404).json({ error: 'Pack not found' });
    if (pack.owner_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

    const mime     = req.file.mimetype;
    const origname = (req.file.originalname || '').toLowerCase();
    const isVideo  = mime.startsWith('video/');
    const isSvg    = mime === 'image/svg+xml';

    // MIME-type detection (browser-reported, can be unreliable on some OS/browsers)
    const isGif = mime === 'image/gif' || mime === 'image/apng'
      || origname.endsWith('.gif') || origname.endsWith('.apng');

    // Detect animated WebP via sharp metadata
    let isAnimatedWebP = false;
    if (!isGif && mime === 'image/webp') {
      try {
        const meta = await sharp(req.file.buffer, { animated: true }).metadata();
        isAnimatedWebP = (meta.pages ?? 1) > 1;
      } catch { /* treat as static */ }
    }

    // Content-based animation detection — final fallback when MIME type is wrong
    // (e.g. browser reports application/octet-stream for a .gif file on some systems)
    let isContentAnimated = isGif || isAnimatedWebP;
    let detectedMime = mime;
    if (!isContentAnimated && !isVideo && !isSvg) {
      try {
        const meta = await sharp(req.file.buffer, { animated: true }).metadata();
        if ((meta.pages ?? 1) > 1) {
          isContentAnimated = true;
          // Use format detected from file content to pick the right MIME / extension
          const FMT_MIME = { gif: 'image/gif', webp: 'image/webp', png: 'image/png', apng: 'image/apng' };
          detectedMime = FMT_MIME[meta.format] || mime;
        }
      } catch { /* not detectable — treat as static */ }
    }

    // ── Enforce 100-sticker limit per pack ───────────────────────────────────
    const itemCount = db.prepare(
      'SELECT COUNT(*) AS n FROM sticker_pack_items WHERE pack_id = ?'
    ).get([req.params.id]).n;
    if (itemCount >= 100) {
      return res.status(400).json({ error: 'pack_item_limit', message: 'Максимум 100 стикеров на пак' });
    }

    // ── Process full-size sticker ────────────────────────────────────────────
    let fileBuffer, fileMime;
    if (isContentAnimated || isVideo || isSvg) {
      fileBuffer = req.file.buffer;
      fileMime   = isContentAnimated && detectedMime !== mime ? detectedMime : mime;

      // GIF / APNG → animated WebP: typically 40–60% smaller, same animation quality.
      // Already-WebP and video formats are efficient enough — skip re-encoding.
      const isGifOrApng = fileMime === 'image/gif' || fileMime === 'image/apng';
      if (isContentAnimated && isGifOrApng) {
        try {
          const compressed = await sharp(req.file.buffer, { animated: true })
            .webp({ quality: 85, effort: 4 })
            .toBuffer();
          // Only swap if actually smaller (WebP is almost always smaller than GIF)
          if (compressed.length < fileBuffer.length) {
            fileBuffer = compressed;
            fileMime   = 'image/webp';
          }
        } catch { /* keep original GIF if conversion fails */ }
      }
    } else {
      // Static raster → resize max 512×512, convert to WebP
      try {
        fileBuffer = await sharp(req.file.buffer)
          .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 90 })
          .toBuffer();
        fileMime = 'image/webp';
      } catch {
        // Fallback: pass through original if sharp can't handle the format
        fileBuffer = req.file.buffer;
        fileMime   = mime;
      }
    }
    const fileUrl = await saveFile(fileBuffer, fileMime, 'stk');

    // ── Thumbnail (always static 100×100 WebP, skip for video/SVG) ──────────
    let thumbUrl = null;
    if (!isVideo && !isSvg) {
      try {
        const thumbBuffer = await sharp(req.file.buffer, { pages: 1 })
          .resize({ width: 100, height: 100, fit: 'cover' })
          .webp({ quality: 80 })
          .toBuffer();
        thumbUrl = await saveFile(thumbBuffer, 'image/webp', 'stk-thumb');
      } catch { /* no thumb */ }
    }

    // ── Persist ───────────────────────────────────────────────────────────────
    const itemId     = uuidv4();
    const emojiHint  = req.body?.emoji_hint?.trim() || null;
    const keywords   = req.body?.keywords
      ? JSON.stringify(req.body.keywords.split(',').map(k => k.trim()).filter(Boolean))
      : null;
    const maxOrder = db.prepare(
      'SELECT COALESCE(MAX(sort_order), -1) AS m FROM sticker_pack_items WHERE pack_id = ?'
    ).get([req.params.id]).m;

    db.prepare(`INSERT INTO sticker_pack_items
      (id, pack_id, file_url, thumb_url, emoji_hint, keywords, sort_order, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run([itemId, req.params.id, fileUrl, thumbUrl, emojiHint, keywords, maxOrder + 1, Date.now()]);

    // Mark pack as animated if needed
    const isAnimated = isGif || isAnimatedWebP;
    if (isAnimated && !pack.is_animated) {
      db.prepare('UPDATE sticker_packs SET is_animated = 1, updated_at = ? WHERE id = ?')
        .run([Date.now(), req.params.id]);
    }

    res.status(201).json(mapItem(db.prepare('SELECT * FROM sticker_pack_items WHERE id = ?').get([itemId])));
  } catch (err) {
    console.error('[Stickers] Upload error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /sticker-packs/:id/items/:itemId — update emoji_hint (owner only)
router.patch('/:id/items/:itemId', (req, res) => {
  const db = getDb();
  try {
    const item = db.prepare(
      'SELECT spi.*, sp.owner_id FROM sticker_pack_items spi JOIN sticker_packs sp ON sp.id = spi.pack_id WHERE spi.id = ? AND spi.pack_id = ?'
    ).get([req.params.itemId, req.params.id]);
    if (!item) return res.status(404).json({ error: 'Not found' });
    if (item.owner_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

    const emojiHint = req.body?.emoji_hint !== undefined
      ? (req.body.emoji_hint?.trim() || null)
      : item.emoji_hint;

    db.prepare('UPDATE sticker_pack_items SET emoji_hint = ? WHERE id = ?').run([emojiHint, req.params.itemId]);
    const updated = db.prepare('SELECT * FROM sticker_pack_items WHERE id = ?').get([req.params.itemId]);
    res.json(mapItem(updated));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /sticker-packs/:id/items/:itemId
router.delete('/:id/items/:itemId', (req, res) => {
  const db = getDb();
  try {
    const item = db.prepare(
      'SELECT spi.*, sp.owner_id FROM sticker_pack_items spi JOIN sticker_packs sp ON sp.id = spi.pack_id WHERE spi.id = ? AND spi.pack_id = ?'
    ).get([req.params.itemId, req.params.id]);
    if (!item) return res.status(404).json({ error: 'Not found' });
    if (item.owner_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

    db.prepare('DELETE FROM sticker_pack_items WHERE id = ?').run([req.params.itemId]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /sticker-packs/:id/items/order — body: { ids: string[] }
router.patch('/:id/items/order', (req, res) => {
  const db = getDb();
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  try {
    const pack = db.prepare('SELECT * FROM sticker_packs WHERE id = ? AND is_deleted = 0').get([req.params.id]);
    if (!pack) return res.status(404).json({ error: 'Not found' });
    if (pack.owner_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

    const stmt = db.prepare('UPDATE sticker_pack_items SET sort_order = ? WHERE id = ? AND pack_id = ?');
    db.exec('BEGIN');
    try {
      ids.forEach((id, i) => stmt.run([i, id, req.params.id]));
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
//  REPORT / COMPLAINT
// ────────────────────────────────────────────────────────────────────────────

// POST /sticker-packs/:id/report — body: { reason: string }
router.post('/:id/report', (req, res, next) => {
  try {
    const db = getDb();
    const packId = req.params.id;
    const reason = (req.body?.reason || '').trim().slice(0, 1000) || null;

    const pack = db.prepare('SELECT id FROM sticker_packs WHERE id = ? AND is_deleted = 0').get([packId]);
    if (!pack) return res.status(404).json({ error: 'Pack not found' });

    const existing = db.prepare(
      'SELECT id FROM content_reports WHERE reporter_id = ? AND content_id = ? AND content_type = ?'
    ).get([req.user.id, packId, 'sticker_pack']);
    if (existing) return res.status(409).json({ error: 'Вы уже отправляли жалобу на этот пак' });

    db.prepare(
      'INSERT INTO content_reports (id, reporter_id, content_type, content_id, reason, resolved, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)'
    ).run([uuidv4(), req.user.id, 'sticker_pack', packId, reason, Date.now()]);

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ────────────────────────────────────────────────────────────────────────────
//  QUOTA ROUTE (exported separately as /quota/my)
// ────────────────────────────────────────────────────────────────────────────

// Exported so index.js can mount it at /quota/my via a tiny sub-router
const quotaRouter = express.Router();
quotaRouter.use(authMiddleware);
quotaRouter.get('/my', (req, res) => {
  const db = getDb();
  try {
    const quota = getOrCreateQuota(db, req.user.id);
    res.json(quota);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = { stickerPacksRouter: router, quotaRouter };
