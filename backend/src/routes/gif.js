const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');

const GIPHY_BASE = 'https://api.giphy.com/v1/gifs';

/**
 * Map a single Giphy result object to our GifResult shape.
 * We send fixed_width (200px) in chat — small enough to be fast, good enough quality.
 * Grid preview uses fixed_width_small (100px) for fast loading.
 */
function mapGiphyResult(r) {
  const images = r.images || {};
  const full    = images.downsized           || images.fixed_width  || {};
  const preview = images.fixed_width         || images.downsized    || {};
  return {
    id:      r.id,
    url:     full.url     || '',
    preview: preview.url  || full.url || '',
    width:   Number(full.width)  || 0,
    height:  Number(full.height) || 0,
    title:   r.title || '',
  };
}

async function giphyFetch(path, params) {
  const key = process.env.GIPHY_API_KEY;
  if (!key) {
    throw Object.assign(new Error('GIPHY_API_KEY not configured'), { status: 503 });
  }

  const qs = new URLSearchParams({ api_key: key, ...params }).toString();
  const url = `${GIPHY_BASE}${path}?${qs}`;

  const resp = await fetch(url);
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw Object.assign(new Error(`Giphy API error ${resp.status}: ${text}`), { status: 502 });
  }
  return resp.json();
}

// GET /gif/trending?limit=20&offset=0
router.get('/trending', authMiddleware, async (req, res) => {
  try {
    const limit  = Math.min(Number(req.query.limit)  || 20, 50);
    const offset = Math.max(Number(req.query.offset) || 0,  0);
    const data   = await giphyFetch('/trending', {
      limit:  String(limit),
      offset: String(offset),
      rating: 'g',
      lang:   'ru',
    });
    res.json({
      results: (data.data || []).map(mapGiphyResult),
      next:    String(offset + limit),
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// GET /gif/search?q=cats&limit=20&offset=0
router.get('/search', authMiddleware, async (req, res) => {
  try {
    const q      = String(req.query.q || '').trim();
    const limit  = Math.min(Number(req.query.limit)  || 20, 50);
    const offset = Math.max(Number(req.query.offset) || 0,  0);
    if (!q) return res.status(400).json({ error: 'q is required' });

    const data = await giphyFetch('/search', {
      q,
      limit:  String(limit),
      offset: String(offset),
      rating: 'g',
      lang:   'ru',
    });
    res.json({
      results: (data.data || []).map(mapGiphyResult),
      next:    String(offset + limit),
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// GET /gif/my — personal GIFs (stub until Stage 6)
router.get('/my', authMiddleware, async (req, res) => {
  const { getDb } = require('../config/database');
  const db = getDb();
  const userId = req.user.id;
  try {
    const rows = db.prepare(
      `SELECT * FROM user_gifs WHERE owner_id = ? AND is_deleted = 0 ORDER BY created_at DESC`
    ).all([userId]);
    res.json(rows.map(r => ({
      ...r,
      is_public:  !!r.is_public,
      is_deleted: !!r.is_deleted,
      keywords:   r.keywords ? JSON.parse(r.keywords) : null,
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
