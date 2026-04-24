/**
 * routes/linkPreview.js
 *
 * Fetch and cache Open Graph / meta previews for URLs.
 *   GET /link-preview?url=<url>
 *
 * Returns: { url, title, description, image }
 * Caches results in SQLite for 24 hours (per URL).
 */

const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { linkPreviewLimiter } = require('../middleware/rateLimits');
const { getDb } = require('../config/database');

const router = express.Router();
router.use(authMiddleware);

const CACHE_TTL = 86_400_000; // 24 hours
const MAX_BODY  = 200_000;    // 200 KB

// Block local/private IPs to prevent SSRF
function isSafeUrl(urlStr) {
  let u;
  try { u = new URL(urlStr); } catch { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const h = u.hostname;
  if (
    h === 'localhost' ||
    h.startsWith('127.') ||
    h.startsWith('10.') ||
    h.startsWith('192.168.') ||
    h.match(/^172\.(1[6-9]|2\d|3[01])\./) ||
    h === '0.0.0.0' ||
    h.endsWith('.local')
  ) return false;
  return true;
}

function extractMeta(html) {
  const og = (prop) => {
    const m = html.match(new RegExp(`<meta[^>]+property=["']og:${prop}["'][^>]+content=["']([^"']+)["']`, 'i'))
           || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:${prop}["']`, 'i'));
    return m ? m[1].trim() : null;
  };
  const title = og('title')
    || (html.match(/<title[^>]*>([^<]{1,200})<\/title>/i)?.[1]?.trim() ?? null);
  const description = og('description')
    || (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{1,400})["']/i)?.[1]?.trim() ?? null);
  const image = og('image') || null;
  return { title, description, image };
}

router.get('/', linkPreviewLimiter, async (req, res) => {
  const url = (req.query.url || '').trim();

  if (!isSafeUrl(url)) {
    return res.status(400).json({ error: 'Invalid or disallowed URL' });
  }

  const db = getDb();
  const now = Date.now();

  // Cache hit?
  const cached = db.prepare(
    `SELECT title, description, image FROM link_previews WHERE url = ? AND fetched_at > ?`
  ).get([url, now - CACHE_TTL]);

  if (cached) {
    return res.json({ url, title: cached.title, description: cached.description, image: cached.image });
  }

  // Fetch
  let title = null, description = null, image = null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LinkPreviewBot/1.0)' },
    });
    clearTimeout(timer);

    if (response.ok) {
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('text/html')) {
        const text = await response.text();
        const sliced = text.slice(0, MAX_BODY);
        ({ title, description, image } = extractMeta(sliced));
      }
    }
  } catch {
    // timeout or fetch error — return null fields, still cache to avoid hammering
  }

  // Upsert cache
  db.prepare(
    `INSERT INTO link_previews (url, title, description, image, fetched_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(url) DO UPDATE SET title=excluded.title, description=excluded.description,
       image=excluded.image, fetched_at=excluded.fetched_at`
  ).run([url, title, description, image, now]);

  res.json({ url, title, description, image });
});

module.exports = router;
