/* Service Worker — Web Push + media/API caching for Blizkie messenger */

const MEDIA_CACHE  = 'blizkie-media-v1';
const API_CACHE    = 'blizkie-api-v1';
const API_TTL_MS   = 60_000; // 1 min for installed-packs list

// ── Push notification handler ─────────────────────────────────────────────
self.addEventListener('push', e => {
  if (!e.data) return;
  let data;
  try { data = e.data.json(); } catch { return; }

  const title = data.title || 'Blizkie';
  const options = {
    body: data.body || '',
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    data: { chatId: data.chatId },
    vibrate: [200, 100, 200],
  };

  e.waitUntil(self.registration.showNotification(title, options));
});

// ── Notification click ────────────────────────────────────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if ('focus' in client) return client.focus();
      }
      return clients.openWindow('/');
    })
  );
});

// ── Fetch: cache strategies ───────────────────────────────────────────────
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // 1. Static media from /uploads/ — cache-first, long TTL
  //    Sticker/emoji images and videos rarely change; serve from cache instantly.
  if (url.pathname.startsWith('/uploads/')) {
    e.respondWith(cacheFirst(e.request, MEDIA_CACHE));
    return;
  }

  // 2. Sticker pack item lists — stale-while-revalidate with 1-min TTL
  //    /sticker-packs/installed and /sticker-packs/:id/items
  if (
    url.pathname.startsWith('/sticker-packs/') &&
    (url.pathname.endsWith('/items') || url.pathname.endsWith('/installed'))
  ) {
    e.respondWith(staleWhileRevalidate(e.request, API_CACHE, API_TTL_MS));
    return;
  }
});

// ── Cache helpers ─────────────────────────────────────────────────────────

/** Cache-first: return cached response if present, else fetch + cache. */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const fresh = await fetch(request);
    if (fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  } catch {
    return new Response('Offline', { status: 503 });
  }
}

/**
 * Stale-while-revalidate: return cached immediately (if fresh enough),
 * always trigger a background revalidation fetch.
 */
async function staleWhileRevalidate(request, cacheName, ttlMs) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const now = Date.now();

  // Parse our custom timestamp header that we add on cache.put
  const storedAt = cached ? Number(cached.headers.get('x-sw-cached-at') || 0) : 0;
  const isFresh  = cached && (now - storedAt) < ttlMs;

  // Background revalidation (or foreground if no cache)
  const revalidate = fetch(request).then(async fresh => {
    if (fresh.ok) {
      // Clone the response and inject a timestamp header before caching
      const headers = new Headers(fresh.headers);
      headers.set('x-sw-cached-at', String(Date.now()));
      const stamped = new Response(await fresh.clone().arrayBuffer(), {
        status:  fresh.status,
        headers,
      });
      cache.put(request, stamped);
    }
    return fresh;
  }).catch(() => null);

  if (isFresh) return cached;          // serve stale immediately
  if (cached) {
    revalidate.catch(() => {});        // fire-and-forget
    return cached;                     // serve stale (slightly old)
  }
  return (await revalidate) || new Response('Offline', { status: 503 });
}

// ── Cleanup old caches on activation ─────────────────────────────────────
self.addEventListener('activate', e => {
  const keep = new Set([MEDIA_CACHE, API_CACHE]);
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => !keep.has(k)).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});
