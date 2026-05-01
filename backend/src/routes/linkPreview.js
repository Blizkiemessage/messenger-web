/**
 * routes/linkPreview.js
 *
 * Fetch and cache Open Graph / meta previews for URLs.
 *   GET /link-preview?url=<url>
 *
 * Returns: { url, title, description, image }
 * Caches results in SQLite for 24 hours (per URL).
 *
 * ── SSRF protection (B5) ────────────────────────────────────────────────────
 * Three-layer defence so the server cannot be used as a proxy to reach
 * internal infrastructure (AWS metadata, Redis, internal APIs, etc.):
 *
 *  1. URL validation — protocol, port, and hostname blocklist checked before
 *     any network activity.
 *  2. DNS pre-resolution — hostname is resolved to IPs and every address is
 *     validated against private/reserved ranges via ipaddr.js before fetch.
 *  3. Manual redirect following — each redirect hop is validated with the
 *     same two checks above before the next request is made. This prevents
 *     the classic "external domain redirects to 169.254.169.254" attack.
 */

'use strict';

const express    = require('express');
const dnsPromises = require('dns').promises;
const net        = require('net');
const ipaddr     = require('ipaddr.js');

const { authMiddleware }    = require('../middleware/auth');
const { linkPreviewLimiter } = require('../middleware/rateLimits');
const { getDb }             = require('../config/database');

const router = express.Router();
router.use(authMiddleware);

// ── Constants ───────────────────────────────────────────────────────────────

const CACHE_TTL      = 86_400_000; // 24 hours in ms
const MAX_BODY       = 200_000;    // read at most 200 KB of HTML per fetch
const MAX_REDIRECTS  = 3;          // follow at most 3 redirect hops
const FETCH_TIMEOUT  = 5_000;      // 5 seconds per individual request

// Only http and https are permitted.
const SAFE_PROTOCOLS = new Set(['http:', 'https:']);

// Port must be 80, 443, or the protocol default (empty string).
// This blocks requests to non-HTTP ports like Redis (6379), Postgres (5432), etc.
const SAFE_PORTS = new Set(['', '80', '443']);

// Exact hostnames that are always blocked.
const BLOCKED_HOSTS = new Set([
  'localhost',
  'broadcasthost',
  'ip6-localhost',
  'ip6-loopback',
]);

// Any hostname ending with one of these suffixes is blocked.
// Covers mDNS (.local), corporate internal zones (.corp / .internal / .lan),
// and explicit .localhost aliases.
const BLOCKED_SUFFIXES = [
  '.local',
  '.localhost',
  '.internal',
  '.corp',
  '.home',
  '.lan',
  '.localdomain',
  '.intranet',
];

// ── SSRF helpers ─────────────────────────────────────────────────────────────

/**
 * Returns true only when the IP string resolves to a publicly-routable address.
 *
 * Blocked ranges (via ipaddr.js):
 *   IPv4 — loopback (127/8), private (10/8, 172.16/12, 192.168/16),
 *           link-local (169.254/16), multicast (224/4), broadcast,
 *           reserved, unspecified (0.0.0.0)
 *   IPv6 — loopback (::1), unique-local (fc00::/7), link-local (fe80::/10),
 *           multicast (ff00::/8), IPv4-mapped (::ffff:x / handled via .process())
 *
 * ipaddr.process() automatically converts IPv4-mapped IPv6 addresses
 * (e.g. ::ffff:127.0.0.1) to their IPv4 equivalent before range checking,
 * so those sneaky bypasses are caught too.
 */
function isSafeIp(ipStr) {
  try {
    // .process() unwraps IPv4-mapped IPv6 (::ffff:x.x.x.x) → plain IPv4
    const addr = ipaddr.process(ipStr);
    return addr.range() === 'unicast';
  } catch {
    return false;
  }
}

/**
 * Full pre-flight URL safety check.
 *
 * Checks (in order):
 *   1. URL must parse without throwing.
 *   2. Protocol must be http or https.
 *   3. Port must be 80, 443, or default.
 *   4. Hostname must not match the blocklist.
 *   5. If hostname is a literal IP address → validate directly.
 *   6. DNS lookup → validate every resolved address.
 *
 * Returns true only when ALL checks pass.
 */
async function isSafeUrl(rawUrl) {
  // ── 1. Parse ─────────────────────────────────────────────────────────────
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }

  // ── 2. Protocol ──────────────────────────────────────────────────────────
  if (!SAFE_PROTOCOLS.has(parsed.protocol)) return false;

  // ── 3. Port ──────────────────────────────────────────────────────────────
  if (!SAFE_PORTS.has(parsed.port)) return false;

  // ── 4. Hostname blocklist ─────────────────────────────────────────────────
  const hostname = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(hostname)) return false;
  if (BLOCKED_SUFFIXES.some(s => hostname.endsWith(s))) return false;

  // ── 5. Literal IP address ─────────────────────────────────────────────────
  // Strip IPv6 brackets ("[::1]" → "::1") before checking.
  const bare = hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(bare)) {
    return isSafeIp(bare);
  }

  // ── 6. DNS resolution ─────────────────────────────────────────────────────
  // Resolve all address families (A + AAAA) and reject if any resolved
  // address falls outside the public unicast range.
  let addresses;
  try {
    addresses = await dnsPromises.lookup(hostname, { all: true, family: 0 });
  } catch {
    // DNS failure (NXDOMAIN, timeout, etc.) — refuse to fetch.
    return false;
  }

  if (!addresses || addresses.length === 0) return false;

  for (const { address } of addresses) {
    if (!isSafeIp(address)) return false;
  }

  return true;
}

/**
 * Fetches a URL safely, manually following each redirect hop so that every
 * intermediate URL is validated against SSRF rules before the next request.
 *
 * Attack prevented: attacker registers evil.com → redirects to 169.254.169.254.
 * Without manual redirect handling Node would silently follow the redirect;
 * with `redirect: 'manual'` we intercept the Location header, validate it,
 * and only proceed if it is safe.
 *
 * @param {string}  rawUrl        - URL to fetch
 * @param {number}  redirectsLeft - remaining allowed hops (default: MAX_REDIRECTS)
 * @returns {Response}
 */
async function safeFetch(rawUrl, redirectsLeft = MAX_REDIRECTS) {
  // Hard stop on redirect chain length — treat as error, not as "no preview"
  if (redirectsLeft < 0) {
    throw Object.assign(new Error('Too many redirects'), { code: 'TOO_MANY_REDIRECTS' });
  }

  // Validate BEFORE making any network request
  if (!(await isSafeUrl(rawUrl))) {
    throw Object.assign(new Error('Unsafe URL blocked by SSRF filter'), { code: 'SSRF_BLOCKED' });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  let response;
  try {
    response = await fetch(rawUrl, {
      signal:   controller.signal,
      redirect: 'manual', // NEVER let Node follow redirects automatically
      headers: {
        'User-Agent':      'Mozilla/5.0 (compatible; Blizkie/1.0 LinkPreview)',
        'Accept':          'text/html,application/xhtml+xml;q=0.9',
        'Accept-Language': 'ru,en;q=0.8',
      },
    });
  } finally {
    clearTimeout(timer);
  }

  // ── Manual redirect handling ───────────────────────────────────────────────
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location');
    if (!location) {
      throw new Error('Redirect response with no Location header');
    }

    // Resolve relative Location against the current URL
    let nextUrl;
    try {
      nextUrl = new URL(location, rawUrl).href;
    } catch {
      throw new Error('Invalid redirect Location URL');
    }

    // Validate and follow the next hop
    return safeFetch(nextUrl, redirectsLeft - 1);
  }

  return response;
}

// ── Open Graph / meta extraction ─────────────────────────────────────────────

/**
 * Extracts title, description, and image from raw HTML.
 * Tries og: properties first, falls back to standard meta/title tags.
 * Input is sliced to MAX_BODY before being passed in to limit memory use.
 */
function extractMeta(html) {
  const og = (prop) => {
    // og: tags can have property/content in either order
    return (
      html.match(new RegExp(`<meta[^>]+property=["']og:${prop}["'][^>]+content=["']([^"']{1,500})["']`, 'i'))?.[1]?.trim() ??
      html.match(new RegExp(`<meta[^>]+content=["']([^"']{1,500})["'][^>]+property=["']og:${prop}["']`, 'i'))?.[1]?.trim() ??
      null
    );
  };

  const title =
    og('title') ??
    html.match(/<title[^>]*>([^<]{1,200})<\/title>/i)?.[1]?.trim() ??
    null;

  const description =
    og('description') ??
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{1,500})["']/i)?.[1]?.trim() ??
    null;

  const image = og('image') ?? null;

  return { title, description, image };
}

// ── Route ─────────────────────────────────────────────────────────────────────

/**
 * GET /link-preview?url=<url>
 *
 * Returns { url, title, description, image }.
 * All fields except `url` may be null when no metadata is available.
 * Results are cached in SQLite for CACHE_TTL ms to avoid re-fetching.
 */
router.get('/', linkPreviewLimiter, async (req, res) => {
  const url = (req.query.url || '').trim();

  if (!url) {
    return res.status(400).json({ error: 'url query parameter is required' });
  }

  // Fast pre-flight: protocol + port + hostname blocklist (synchronous checks only).
  // The async DNS check runs inside safeFetch, but we can short-circuit obvious bads here.
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }
  if (!SAFE_PROTOCOLS.has(parsed.protocol) || !SAFE_PORTS.has(parsed.port)) {
    return res.status(400).json({ error: 'Invalid or disallowed URL' });
  }

  const db  = getDb();
  const now = Date.now();

  // ── Cache lookup ──────────────────────────────────────────────────────────
  const cached = db.prepare(
    `SELECT title, description, image FROM link_previews
     WHERE url = ? AND fetched_at > ?`
  ).get([url, now - CACHE_TTL]);

  if (cached) {
    return res.json({
      url,
      title:       cached.title,
      description: cached.description,
      image:       cached.image,
    });
  }

  // ── Fetch with SSRF protection ────────────────────────────────────────────
  let title = null, description = null, image = null;

  try {
    const response = await safeFetch(url);

    if (response.ok) {
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('text/html')) {
        const text = await response.text();
        ({ title, description, image } = extractMeta(text.slice(0, MAX_BODY)));
      }
    }
  } catch (err) {
    // SSRF_BLOCKED — silently return null fields (don't reveal filter logic to clients)
    // TOO_MANY_REDIRECTS / timeout — same treatment
    // We still cache the empty result to prevent hammering the same bad URL.
    if (process.env.NODE_ENV !== 'production') {
      // Log only in dev so engineers can debug blocked URLs
      console.warn('[linkPreview] fetch error:', err.code ?? err.message, url);
    }
  }

  // ── Cache result (upsert) ─────────────────────────────────────────────────
  // Cache even on failure — returns null fields, prevents repeat fetch storms.
  db.prepare(
    `INSERT INTO link_previews (url, title, description, image, fetched_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(url) DO UPDATE SET
       title       = excluded.title,
       description = excluded.description,
       image       = excluded.image,
       fetched_at  = excluded.fetched_at`
  ).run([url, title, description, image, now]);

  res.json({ url, title, description, image });
});

module.exports = router;
