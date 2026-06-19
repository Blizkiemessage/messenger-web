'use strict';

/**
 * routes/admin/stats.js — high-level dashboard counters.
 * GET /stats?from=<ms>&to=<ms>
 */
const express = require('express');
const { getDb } = require('../../config/database');

const router = express.Router();

const ALLOWED_TABLES = new Set(['users', 'chats', 'messages', 'support_reports', 'sessions']);
const ALLOWED_SUPPORT_TYPES = new Set(['bug', 'feature', 'other']);

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

module.exports = router;
