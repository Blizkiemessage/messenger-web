const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');

const TENOR_BASE = 'https://tenor.googleapis.com/v2';

/**
 * Map a single Tenor result object to our TenorGif shape.
 * Tenor v2 returns `media_formats` (object keyed by format name).
 */
function mapTenorResult(r) {
  const fmt = r.media_formats || {};
  const gif = fmt.gif || {};
  const tiny = fmt.tinygif || fmt.nanogif || fmt.gif || {};
  return {
    id: r.id,
    url: gif.url || '',
    preview: tiny.url || gif.url || '',
    width: (gif.dims && gif.dims[0]) || 0,
    height: (gif.dims && gif.dims[1]) || 0,
    title: r.title || '',
  };
}

async function tenorFetch(path, params) {
  const key = process.env.TENOR_API_KEY;
  if (!key) {
    throw Object.assign(new Error('TENOR_API_KEY not configured'), { status: 503 });
  }

  const qs = new URLSearchParams({ key, ...params }).toString();
  const url = `${TENOR_BASE}${path}?${qs}`;

  const resp = await fetch(url);
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw Object.assign(new Error(`Tenor API error ${resp.status}: ${text}`), { status: 502 });
  }
  return resp.json();
}

// GET /gif/trending?limit=20&pos=
router.get('/trending', requireAuth, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 50);
    const pos   = req.query.pos   || '';
    const data  = await tenorFetch('/featured', {
      limit: String(limit),
      pos,
      media_filter: 'gif',
      contentfilter: 'medium',
      locale: 'ru_RU',
    });
    res.json({
      results: (data.results || []).map(mapTenorResult),
      next: data.next || '',
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// GET /gif/search?q=cats&limit=20&pos=
router.get('/search', requireAuth, async (req, res) => {
  try {
    const q     = String(req.query.q || '').trim();
    const limit = Math.min(Number(req.query.limit) || 20, 50);
    const pos   = req.query.pos || '';
    if (!q) return res.status(400).json({ error: 'q is required' });

    const data = await tenorFetch('/search', {
      q,
      limit: String(limit),
      pos,
      media_filter: 'gif',
      contentfilter: 'medium',
      locale: 'ru_RU',
    });
    res.json({
      results: (data.results || []).map(mapTenorResult),
      next: data.next || '',
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// GET /gif/my — personal GIFs (stub until Stage 6)
router.get('/my', requireAuth, async (req, res) => {
  const { getDb } = require('../config/database');
  const db = getDb();
  const userId = req.user.id;
  try {
    const rows = db.prepare(
      `SELECT * FROM user_gifs WHERE owner_id = ? AND is_deleted = 0 ORDER BY created_at DESC`
    ).all([userId]);
    res.json(rows.map(r => ({
      ...r,
      is_public: !!r.is_public,
      is_deleted: !!r.is_deleted,
      keywords: r.keywords ? JSON.parse(r.keywords) : null,
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
