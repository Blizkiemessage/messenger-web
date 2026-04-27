const crypto = require('crypto');
const bcryptjs = require('bcryptjs');
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authMiddleware } = require('../middleware/auth');
const { adminLoginLimiter } = require('../middleware/rateLimits');
const { getDb } = require('../config/database');
const { sign } = require('../utils/jwt');
const { deleteManyFromS3 } = require('../utils/s3Delete');
const { logAdminAction } = require('../services/adminAuditService');

function clientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || null;
}

const router = express.Router();

// POST /admin/api/login
router.post('/login', adminLoginLimiter, async (req, res, next) => {
  console.log('[ADMIN LOGIN] attempt received, body keys:', Object.keys(req.body || {}));
  try {
    const expectedUser   = process.env.ADMIN_USERNAME      || '';
    const passwordHash   = process.env.ADMIN_PASSWORD_HASH || '';
    console.log('[ADMIN LOGIN] env check — username set:', !!expectedUser, 'hash set:', !!passwordHash, 'hash prefix:', passwordHash.slice(0, 7));

    if (!expectedUser || !passwordHash) {
      return res.status(503).json({ error: 'Admin not configured' });
    }

    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username и пароль обязательны' });
    }

    console.log('[ADMIN LOGIN] running bcrypt compare...');
    let usernameMatch = false;
    try {
      const a = Buffer.from(username.toLowerCase());
      const b = Buffer.from(expectedUser.toLowerCase());
      usernameMatch = a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch { usernameMatch = false; }

    const passwordMatch = await bcryptjs.compare(password, passwordHash);
    console.log('[ADMIN LOGIN] usernameMatch:', usernameMatch, 'passwordMatch:', passwordMatch);

    if (!usernameMatch || !passwordMatch) {
      return res.status(401).json({ error: 'Неверный логин или пароль' });
    }

    const db = getDb();
    const user = db.prepare('SELECT id FROM users WHERE LOWER(username) = ?').get(expectedUser.toLowerCase());
    console.log('[ADMIN LOGIN] user found in DB:', !!user);

    if (!user) {
      return res.status(404).json({ error: 'Admin user not found in DB' });
    }

    const jti = uuidv4();
    const now = Date.now();
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || null;
    db.prepare('INSERT INTO sessions (id, user_id, created_at, revoked, user_agent, last_used_at, ip_address) VALUES (?, ?, ?, 0, ?, ?, ?)')
      .run([jti, user.id, now, req.headers['user-agent'] || null, now, ip]);

    const token = sign({ sub: user.id, jti });
    console.log('[ADMIN LOGIN] success, token issued');
    res.json({ token });
  } catch (err) {
    console.log('[ADMIN LOGIN ERROR]', err?.message);
    console.log('[ADMIN LOGIN ERROR STACK]', err?.stack);
    next(err);
  }
});

router.use(authMiddleware);

// Middleware to ensure the user is the configured admin
function isAdmin(req, res, next) {
  const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
  if (!ADMIN_USERNAME) {
    return res.status(503).json({ error: 'Admin not configured' });
  }
  const db = getDb();
  const user = db.prepare('SELECT username FROM users WHERE id = ?').get(req.userId);

  if (!user || user.username.toLowerCase() !== ADMIN_USERNAME.toLowerCase()) {
    return res.status(403).json({ error: 'Access denied: Admins only' });
  }
  next();
}

router.use(isAdmin);

const ALLOWED_TABLES = new Set(['users', 'chats', 'messages', 'support_reports', 'sessions']);
const ALLOWED_SUPPORT_TYPES = new Set(['bug', 'feature', 'other']);

// GET /admin/api/stats?from=<ms>&to=<ms>
router.get('/stats', (req, res, next) => {
  try {
    const db = getDb();
    const from = req.query.from ? parseInt(req.query.from) : null;
    const to   = req.query.to   ? parseInt(req.query.to)   : null;

    if (from !== null && (isNaN(from) || from < 0)) return res.status(400).json({ error: 'Invalid from' });
    if (to   !== null && (isNaN(to)   || to   < 0)) return res.status(400).json({ error: 'Invalid to' });

    // Build a WHERE clause fragment and params for date filtering
    function dateWhere(alias) {
      const col = alias ? `${alias}.created_at` : 'created_at';
      if (from && to)  return { where: `WHERE ${col} >= ? AND ${col} <= ?`, params: [from, to] };
      if (from)        return { where: `WHERE ${col} >= ?`,               params: [from] };
      if (to)          return { where: `WHERE ${col} <= ?`,               params: [to] };
      return { where: '', params: [] };
    }

    function countTable(table) {
      if (!ALLOWED_TABLES.has(table)) throw new Error(`Table not allowed: ${table}`);
      const { where, params } = dateWhere('');
      return db.prepare(`SELECT COUNT(*) as c FROM ${table} ${where}`).get(params).c;
    }

    function countSupport(type) {
      if (!ALLOWED_SUPPORT_TYPES.has(type)) return 0;
      const { where, params } = dateWhere('');
      const and = where ? ' AND type = ?' : 'WHERE type = ?';
      return db.prepare(`SELECT COUNT(*) as c FROM support_reports ${where}${and}`).get([...params, type]).c;
    }

    const contentReports = db.prepare("SELECT COUNT(*) as c FROM content_reports WHERE resolved = 0").get().c;
    const appErrors = db.prepare("SELECT COUNT(*) as c FROM app_errors WHERE level = 'error'").get()?.c ?? 0;

    res.json({
      users:            countTable('users'),
      chats:            countTable('chats'),
      messages:         countTable('messages'),
      support_bugs:     countSupport('bug'),
      support_features: countSupport('feature'),
      content_reports:  contentReports,
      app_errors:       appErrors,
    });
  } catch (err) {
    next(err);
  }
});

// GET /admin/api/users?search=<query>
router.get('/users', (req, res, next) => {
  try {
    const db = getDb();
    const search = req.query.search ? `%${req.query.search.toLowerCase()}%` : null;
    const users = search
      ? db.prepare('SELECT id, username, display_name, email, created_at, last_seen_at FROM users WHERE LOWER(username) LIKE ? OR LOWER(COALESCE(email, \'\')) LIKE ?').all([search, search])
      : db.prepare('SELECT id, username, display_name, email, created_at, last_seen_at FROM users').all();
    res.json(users);
  } catch (err) {
    next(err);
  }
});

// DELETE /admin/api/users/:id
router.delete('/users/:id', (req, res, next) => {
  try {
    const db = getDb();
    const targetUserId = req.params.id;

    if (targetUserId === req.userId) {
      return res.status(400).json({ error: 'Cannot delete yourself' });
    }

    // Collect S3 objects before cascade
    const targetUser = db.prepare('SELECT avatar_url FROM users WHERE id = ?').get(targetUserId);
    const msgAttachments = db
      .prepare('SELECT attachment_url FROM messages WHERE sender_id = ? AND attachment_url IS NOT NULL')
      .all(targetUserId)
      .map(r => r.attachment_url);

    // Cascade delete manually just in case PRAGMA foreign_keys is off
    const deletedUser = db.prepare('SELECT username, display_name FROM users WHERE id = ?').get(targetUserId);

    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM messages WHERE sender_id = ?').run(targetUserId);
      db.prepare('DELETE FROM chat_members WHERE user_id = ?').run(targetUserId);
      db.prepare('DELETE FROM users WHERE id = ?').run(targetUserId);
      // Clean up any empty direct chats
      db.exec(`
        DELETE FROM chats
        WHERE type = 'direct'
        AND id NOT IN (SELECT chat_id FROM chat_members)
      `);
      db.exec('COMMIT');
      // Fire-and-forget S3 cleanup
      deleteManyFromS3([targetUser?.avatar_url, ...msgAttachments]);
      logAdminAction({
        adminUserId: req.userId,
        action: 'delete_user',
        targetType: 'user',
        targetId: targetUserId,
        targetMeta: { username: deletedUser?.username, display_name: deletedUser?.display_name },
        ipAddress: clientIp(req),
        userAgent: req.headers['user-agent'] || null,
      });
      res.json({ ok: true });
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  } catch (err) {
    next(err);
  }
});

// GET /admin/api/chats
router.get('/chats', (req, res, next) => {
  try {
    const db = getDb();
    const chats = db.prepare(`
      SELECT c.id, c.type, c.name, c.created_at, c.creator_id, COUNT(cm.user_id) as member_count
      FROM chats c
      LEFT JOIN chat_members cm ON c.id = cm.chat_id
      GROUP BY c.id
      ORDER BY c.created_at DESC
    `).all();
    res.json(chats);
  } catch (err) {
    next(err);
  }
});

// DELETE /admin/api/chats/:id
router.delete('/chats/:id', (req, res, next) => {
  try {
    const db = getDb();
    const chatId = req.params.id;

    // Collect S3 objects before cascade
    const chat = db.prepare('SELECT avatar_url, type, name FROM chats WHERE id = ?').get(chatId);
    const msgAttachments = db
      .prepare('SELECT attachment_url FROM messages WHERE chat_id = ? AND attachment_url IS NOT NULL')
      .all(chatId)
      .map(r => r.attachment_url);

    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM messages WHERE chat_id = ?').run(chatId);
      db.prepare('DELETE FROM chat_members WHERE chat_id = ?').run(chatId);
      db.prepare('DELETE FROM chats WHERE id = ?').run(chatId);
      db.exec('COMMIT');
      // Fire-and-forget S3 cleanup
      deleteManyFromS3([chat?.avatar_url, ...msgAttachments]);
      logAdminAction({
        adminUserId: req.userId,
        action: 'delete_chat',
        targetType: 'chat',
        targetId: chatId,
        targetMeta: { type: chat?.type, name: chat?.name },
        ipAddress: clientIp(req),
        userAgent: req.headers['user-agent'] || null,
      });
      res.json({ ok: true });
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  } catch (err) {
    next(err);
  }
});

// ── Content reports ──────────────────────────────────────────────────────────

// GET /admin/api/content-reports?resolved=0
router.get('/content-reports', (req, res, next) => {
  try {
    const db = getDb();
    const resolved = req.query.resolved === '1' ? 1 : 0;
    const rows = db.prepare(`
      SELECT cr.*,
        u.username AS reporter_username, u.display_name AS reporter_name,
        sp.name AS pack_name, sp.type AS pack_type, sp.cover_url AS pack_cover,
        ou.username AS owner_username
      FROM content_reports cr
      LEFT JOIN users u ON cr.reporter_id = u.id
      LEFT JOIN sticker_packs sp ON cr.content_id = sp.id
      LEFT JOIN users ou ON sp.owner_id = ou.id
      WHERE cr.resolved = ?
      ORDER BY cr.created_at DESC
    `).all([resolved]);
    res.json(rows);
  } catch (err) { next(err); }
});

// PATCH /admin/api/content-reports/:id/dismiss
router.patch('/content-reports/:id/dismiss', (req, res, next) => {
  try {
    const db = getDb();
    const reportId = req.params.id;
    const report = db.prepare('SELECT content_type, content_id FROM content_reports WHERE id = ?').get(reportId);
    db.prepare('UPDATE content_reports SET resolved = 1 WHERE id = ?').run([reportId]);
    logAdminAction({
      adminUserId: req.userId,
      action: 'dismiss_content_report',
      targetType: 'content_report',
      targetId: reportId,
      targetMeta: { content_type: report?.content_type, content_id: report?.content_id },
      ipAddress: clientIp(req),
      userAgent: req.headers['user-agent'] || null,
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── Sticker packs moderation ─────────────────────────────────────────────────

// GET /admin/api/sticker-packs
router.get('/sticker-packs', (req, res, next) => {
  try {
    const db = getDb();
    const packs = db.prepare(`
      SELECT sp.*, u.username AS owner_username, u.display_name AS owner_name,
        COUNT(spi.id) AS item_count,
        (SELECT COUNT(*) FROM content_reports cr WHERE cr.content_id = sp.id AND cr.resolved = 0) AS report_count
      FROM sticker_packs sp
      LEFT JOIN users u ON sp.owner_id = u.id
      LEFT JOIN sticker_pack_items spi ON spi.pack_id = sp.id
      WHERE sp.is_deleted = 0
      GROUP BY sp.id
      ORDER BY report_count DESC, sp.created_at DESC
    `).all();
    res.json(packs);
  } catch (err) { next(err); }
});

// DELETE /admin/api/sticker-packs/:id
router.delete('/sticker-packs/:id', (req, res, next) => {
  try {
    const db = getDb();
    const packId = req.params.id;
    const pack = db.prepare('SELECT name, type, owner_id FROM sticker_packs WHERE id = ?').get(packId);
    db.prepare('UPDATE sticker_packs SET is_deleted = 1 WHERE id = ?').run([packId]);
    // Mark all related reports resolved
    db.prepare("UPDATE content_reports SET resolved = 1 WHERE content_id = ? AND content_type = 'sticker_pack'").run([packId]);
    logAdminAction({
      adminUserId: req.userId,
      action: 'delete_sticker_pack',
      targetType: 'sticker_pack',
      targetId: packId,
      targetMeta: { name: pack?.name, type: pack?.type, owner_id: pack?.owner_id },
      ipAddress: clientIp(req),
      userAgent: req.headers['user-agent'] || null,
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ────────────────────────────────────────────────────────────────────────────
//  STICKER SELF-HEALING REPAIR
// ────────────────────────────────────────────────────────────────────────────

/**
 * POST /admin/api/sticker-repair
 *
 * Body (all optional):
 *   pack_id  string  — limit repair to one pack
 *   dry_run  bool    — only report what would change, don't write
 *   limit    number  — max items to process (default 50, max 200)
 *
 * For each sticker item that has an orig_url stored:
 *   1. Downloads the current file_url and checks whether it is truly animated
 *      (pages > 1 via sharp metadata).
 *   2. If broken (static / download failed) — downloads the orig_url, runs the
 *      same GIF→WebP conversion pipeline with animated validation, saves a new
 *      stk-{uuid} file and updates file_url + thumb_url in the DB.
 *   3. Returns a per-item audit log so admins can see what was fixed.
 *
 * This endpoint lets admins repair packs at scale without asking every author
 * to re-upload their stickers.
 */
router.post('/sticker-repair', async (req, res, next) => {
  try {
    const db    = getDb();
    const sharp = require('sharp');
    const pathM = require('path');
    const fs    = require('fs');
    const { v4: uuidv4 } = require('uuid');
    const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

    const packId = req.body?.pack_id || null;
    const dryRun = !!req.body?.dry_run;
    const limit  = Math.min(parseInt(String(req.body?.limit || '50')), 200);

    // ── S3 setup (mirrors sticker-packs.js) ─────────────────────────────────
    const useS3 = !!(
      process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY &&
      process.env.S3_BUCKET        && process.env.S3_PUBLIC_URL
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
      'image/jpeg': '.jpg', 'image/webp': '.webp',
    };
    const EXT_MIME = {
      gif: 'image/gif', apng: 'image/apng', webp: 'image/webp',
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    };

    async function saveRepairFile(buffer, mime, prefix) {
      const ext      = MIME_EXT[mime] || '.bin';
      const filename = `${prefix}-${uuidv4()}${ext}`;
      if (useS3) {
        await s3.send(new PutObjectCommand({
          Bucket:             process.env.S3_BUCKET,
          Key:                filename,
          Body:               buffer,
          ContentType:        mime,
          ContentDisposition: 'inline',
          ACL:                'public-read',
        }));
        return `${process.env.S3_PUBLIC_URL.replace(/\/+$/, '')}/${filename}`;
      } else {
        const uploadDir = pathM.join(__dirname, '../../uploads');
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
        fs.writeFileSync(pathM.join(uploadDir, filename), buffer);
        return `/uploads/${filename}`;
      }
    }

    // Download a URL or read a local /uploads/ file as a Buffer
    async function downloadBuffer(url) {
      if (!url) throw new Error('No URL');
      if (url.startsWith('/uploads/')) {
        const filePath = pathM.join(__dirname, '../../uploads', url.replace('/uploads/', ''));
        return fs.readFileSync(filePath);
      }
      const resp = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
      return Buffer.from(await resp.arrayBuffer());
    }

    // Returns true if buffer contains a multi-frame (animated) image
    async function bufferIsAnimated(buffer) {
      if (!buffer || buffer.length <= 1024) return false;
      try {
        const meta = await sharp(buffer, { animated: true }).metadata();
        return (meta.pages ?? 1) > 1;
      } catch { return false; }
    }

    // ── Fetch items ──────────────────────────────────────────────────────────
    const items = packId
      ? db.prepare(
          'SELECT * FROM sticker_pack_items WHERE pack_id = ? AND orig_url IS NOT NULL ORDER BY sort_order ASC LIMIT ?'
        ).all([packId, limit])
      : db.prepare(
          'SELECT * FROM sticker_pack_items WHERE orig_url IS NOT NULL ORDER BY created_at DESC LIMIT ?'
        ).all([limit]);

    const results = [];
    let repaired  = 0;
    let skipped   = 0;
    let errors    = 0;

    for (const item of items) {
      try {
        // ── 1. Check whether current file_url is already a valid animated file ─
        let currentOk = false;
        try {
          const currentBuf = await downloadBuffer(item.file_url);
          currentOk = await bufferIsAnimated(currentBuf);
        } catch { /* treat unreachable URL as broken */ }

        if (currentOk) {
          results.push({ id: item.id, status: 'ok', note: 'Already animated — skipped' });
          skipped++;
          continue;
        }

        // ── 2. Download original ─────────────────────────────────────────────
        const origBuf = await downloadBuffer(item.orig_url);

        // ── 3. Detect MIME from orig_url extension ───────────────────────────
        const origExt  = (item.orig_url.split('?')[0].split('.').pop() || '').toLowerCase();
        const origMime = EXT_MIME[origExt] || 'image/gif';

        let resultBuf  = origBuf;
        let resultMime = origMime;
        let action     = 'kept_original';

        // ── 4. Run GIF/APNG → animated WebP conversion (same logic as upload) ─
        const isGifOrApng = origMime === 'image/gif' || origMime === 'image/apng';
        if (isGifOrApng) {
          try {
            const converted = await sharp(origBuf, { animated: true })
              .webp({ quality: 85, effort: 4 })
              .toBuffer();
            if (await bufferIsAnimated(converted)) {
              resultBuf  = converted;
              resultMime = 'image/webp';
              action     = 'converted_to_webp';
            }
            // If conversion produced a static WebP — fall back to the raw GIF as-is
          } catch { /* keep original GIF */ }
        } else if (origMime === 'image/webp') {
          // Original was already WebP — check if it's animated
          if (await bufferIsAnimated(origBuf)) {
            action = 'restored_orig_webp';
          } else {
            // Original WebP is also static — nothing we can do
            results.push({ id: item.id, status: 'unfixable', note: 'orig_url is static WebP; cannot recover animation' });
            errors++;
            continue;
          }
        } else {
          // Non-animated format (PNG, JPG, etc.) — static sticker, no repair needed
          results.push({ id: item.id, status: 'ok', note: 'Static sticker — skipped' });
          skipped++;
          continue;
        }

        if (dryRun) {
          results.push({ id: item.id, status: 'would_repair', action });
          repaired++;
          continue;
        }

        // ── 5. Save new file_url ─────────────────────────────────────────────
        const newFileUrl = await saveRepairFile(resultBuf, resultMime, 'stk');

        // ── 6. Regenerate thumbnail from the original first frame ────────────
        let newThumbUrl = item.thumb_url;
        try {
          const thumbBuf = await sharp(origBuf, { pages: 1 })
            .resize({ width: 100, height: 100, fit: 'cover' })
            .webp({ quality: 80 })
            .toBuffer();
          newThumbUrl = await saveRepairFile(thumbBuf, 'image/webp', 'stk-thumb');
        } catch { /* keep existing thumbnail */ }

        db.prepare('UPDATE sticker_pack_items SET file_url = ?, thumb_url = ? WHERE id = ?')
          .run([newFileUrl, newThumbUrl, item.id]);

        results.push({ id: item.id, status: 'repaired', action, newFileUrl });
        repaired++;
      } catch (err) {
        results.push({ id: item.id, status: 'error', message: err.message });
        errors++;
      }
    }

    res.json({
      scanned:  items.length,
      repaired,
      skipped,
      errors,
      dry_run:  dryRun,
      results,
    });
  } catch (err) {
    next(err);
  }
});

// ── App error log ────────────────────────────────────────────────────────────

const ALLOWED_ERROR_LEVELS = new Set(['error', 'warn']);

// GET /admin/api/errors?level=error&tag=[S3Delete]&search=&limit=100&offset=0
router.get('/errors', (req, res, next) => {
  try {
    const db = getDb();
    const level  = ALLOWED_ERROR_LEVELS.has(req.query.level) ? req.query.level : null;
    const tag    = req.query.tag    ? req.query.tag.trim()    : null;
    const search = req.query.search ? `%${req.query.search.trim()}%` : null;
    const limit  = Math.min(parseInt(req.query.limit  || '100'), 500);
    const offset = Math.max(parseInt(req.query.offset || '0'),   0);

    const conditions = [];
    const params = [];

    if (level)  { conditions.push('level = ?');           params.push(level); }
    if (tag)    { conditions.push('tag = ?');             params.push(tag); }
    if (search) { conditions.push('(message LIKE ? OR error_text LIKE ?)'); params.push(search, search); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = db.prepare(
      `SELECT * FROM app_errors ${where} ORDER BY ts DESC LIMIT ? OFFSET ?`
    ).all([...params, limit, offset]);

    const total = db.prepare(
      `SELECT COUNT(*) AS c FROM app_errors ${where}`
    ).get(params).c;

    // Unique tags for filter dropdown
    const tags = db.prepare('SELECT DISTINCT tag FROM app_errors WHERE tag IS NOT NULL ORDER BY tag').all().map(r => r.tag);

    res.json({ rows, total, tags });
  } catch (err) {
    next(err);
  }
});

// DELETE /admin/api/errors/:id — remove single entry
router.delete('/errors/:id', (req, res, next) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    db.prepare('DELETE FROM app_errors WHERE id = ?').run([id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// DELETE /admin/api/errors?level=error — clear all (or by level)
router.delete('/errors', (req, res, next) => {
  try {
    const db = getDb();
    const level = ALLOWED_ERROR_LEVELS.has(req.query.level) ? req.query.level : null;
    if (level) {
      db.prepare('DELETE FROM app_errors WHERE level = ?').run([level]);
    } else {
      db.prepare('DELETE FROM app_errors').run();
    }
    logAdminAction({
      adminUserId: req.userId,
      action: 'clear_app_errors',
      targetType: 'app_errors',
      targetMeta: { level: level || 'all' },
      ipAddress: clientIp(req),
      userAgent: req.headers['user-agent'] || null,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── Audit log ────────────────────────────────────────────────────────────────

// GET /admin/api/audit-log?limit=50&offset=0&action=delete_user
router.get('/audit-log', (req, res, next) => {
  try {
    const db     = getDb();
    const limit  = Math.min(parseInt(req.query.limit  || '50'),  500);
    const offset = Math.max(parseInt(req.query.offset || '0'),   0);
    const action = req.query.action ? req.query.action.trim() : null;

    const conditions = [];
    const params     = [];
    if (action) { conditions.push('action = ?'); params.push(action); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const rows = db.prepare(
      `SELECT al.*, u.username AS admin_username
       FROM admin_audit_log al
       LEFT JOIN users u ON u.id = al.admin_user_id
       ${where}
       ORDER BY al.created_at DESC
       LIMIT ? OFFSET ?`
    ).all([...params, limit, offset]);

    const total = db.prepare(
      `SELECT COUNT(*) AS c FROM admin_audit_log ${where}`
    ).get(params).c;

    res.json({ rows, total });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
