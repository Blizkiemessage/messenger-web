'use strict';

/**
 * routes/admin/stickerRepair.js — sticker self-healing repair endpoint.
 *
 * POST /sticker-repair
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
const express = require('express');
const { getDb } = require('../../config/database');

const router = express.Router();

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
        const uploadDir = pathM.join(__dirname, '../../../uploads');
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
        fs.writeFileSync(pathM.join(uploadDir, filename), buffer);
        return `/uploads/${filename}`;
      }
    }

    // Download a URL or read a local /uploads/ file as a Buffer
    async function downloadBuffer(url) {
      if (!url) throw new Error('No URL');
      if (url.startsWith('/uploads/')) {
        const filePath = pathM.join(__dirname, '../../../uploads', url.replace('/uploads/', ''));
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

module.exports = router;
