'use strict';

const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');

/**
 * Creates a content report, deduped per (reporter, content_type, content_id) —
 * mirrors the inline pattern already used for sticker packs
 * (routes/sticker-packs.js:687-694) so every report surface (sticker packs,
 * messages, user profiles) shares one dedup/insert path and lands in the
 * same admin moderation queue (routes/admin/moderation.js).
 * Throws Object.assign(new Error(msg), {status: 409}) on a duplicate report.
 */
function createReport(reporterId, contentType, contentId, reason) {
  const db = getDb();
  const cleanReason = (reason || '').trim().slice(0, 1000) || null;

  const existing = db.prepare(
    'SELECT id FROM content_reports WHERE reporter_id = ? AND content_id = ? AND content_type = ?'
  ).get([reporterId, contentId, contentType]);
  if (existing) {
    throw Object.assign(new Error('Вы уже отправляли жалобу на это'), { status: 409 });
  }

  db.prepare(
    'INSERT INTO content_reports (id, reporter_id, content_type, content_id, reason, resolved, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)'
  ).run([uuidv4(), reporterId, contentType, contentId, cleanReason, Date.now()]);

  return { ok: true };
}

module.exports = { createReport };
