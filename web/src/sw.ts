/// <reference lib="webworker" />
import {
  cleanupOutdatedCaches,
  precacheAndRoute,
  createHandlerBoundToURL,
} from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import {
  NetworkFirst,
  CacheFirst,
  StaleWhileRevalidate,
} from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { API_BASE_URL } from './config';
import { urlBase64ToUint8Array } from './utils/pushKeyEncoding';

declare const self: ServiceWorkerGlobalScope;

// ── Авто-обновление SW ─────────────────────────────────────────────────────
// Без skipWaiting новая версия SW зависает в состоянии "waiting" и не
// активируется, пока не закрыты ВСЕ вкладки приложения — пользователь видит
// старый закэшированный бандл даже после деплоя. Активируем новую версию сразу,
// а clients.claim() (ниже, в activate) сразу берёт управление вкладками →
// следующий reload подхватывает свежую сборку, без ручной очистки кэша.
self.skipWaiting();

// ── Precache all Vite build output ─────────────────────────────────────────
// self.__WB_MANIFEST is replaced at build time by vite-plugin-pwa with
// the actual list of hashed assets (JS chunks, CSS, HTML, images, etc.).
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// ── SPA navigation: all page routes → cached index.html ───────────────────
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')));

// ── API: chat list — NetworkFirst so chats appear offline ──────────────────
// Matches any origin (API lives on a separate domain).
registerRoute(
  ({ url }) => url.pathname === '/chats' || url.pathname.startsWith('/chats/'),
  new NetworkFirst({
    cacheName: 'api-chats-v1',
    networkTimeoutSeconds: 5,
    plugins: [
      new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 3600 }),
    ],
  })
);

// ── Media uploads — CacheFirst, long TTL ──────────────────────────────────
registerRoute(
  ({ url }) => url.pathname.startsWith('/uploads/'),
  new CacheFirst({
    cacheName: 'blizkie-media-v1',
    plugins: [
      new ExpirationPlugin({ maxEntries: 500, maxAgeSeconds: 7 * 24 * 3600 }),
    ],
  })
);

// ── Sticker pack lists — StaleWhileRevalidate ─────────────────────────────
registerRoute(
  ({ url }) =>
    url.pathname.startsWith('/sticker-packs/') &&
    (url.pathname.endsWith('/items') || url.pathname.endsWith('/installed')),
  new StaleWhileRevalidate({
    cacheName: 'blizkie-api-v1',
    plugins: [
      new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 60 }),
    ],
  })
);

// ── Push notifications ─────────────────────────────────────────────────────
self.addEventListener('push', e => {
  if (!e.data) return;
  let data: { title?: string; body?: string; chatId?: number; type?: string; callId?: string };
  try { data = e.data.json(); } catch { return; }

  e.waitUntil((async () => {
    const isCall = data.type === 'call';

    // Incoming call: if the app is already open AND focused, the in-app ringing
    // modal handles it — don't double-notify.
    if (isCall) {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      if (clients.some(c => (c as WindowClient).focused)) return;
    }

    const options = {
      body: data.body || '',
      icon: '/pwa-192x192.png',
      badge: '/favicon.svg',
      data: { chatId: data.chatId, type: data.type, callId: data.callId },
      // Звонок: настойчивая вибрация + держим уведомление, пока не нажмут.
      vibrate: isCall ? [400, 200, 400, 200, 400] : [200, 100, 200],
      requireInteraction: isCall,
      tag: isCall ? 'incoming-call' : undefined,
      renotify: isCall || undefined,
    } as NotificationOptions;

    await self.registration.showNotification(data.title || 'Blizkie', options);
  })());
});

// ── Notification click: focus or open the app ─────────────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const chatId = (e.notification.data as { chatId?: number })?.chatId;
  const target = chatId ? `/?chat=${chatId}` : '/';
  e.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(list => {
        for (const client of list) {
          if ('focus' in client) return client.focus();
        }
        return self.clients.openWindow(target);
      })
  );
});

// ── Activate: take control of all clients immediately ─────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(self.clients.claim());
});

// ── Re-subscribe when the browser invalidates our push subscription ───────
// Without this, a push subscription that dies while no tab is open (or the
// tab never resumes) silently stops delivering anything — including
// incoming-call pushes — until the user happens to trigger a fresh
// registerPush() call from the main thread. Best-effort: relies on the
// HttpOnly session cookie, so it only succeeds where third-party cookies
// aren't blocked (same-origin deploys); cross-origin setups still self-heal
// via the main-thread check in useSocket.ts on next resume.
self.addEventListener('pushsubscriptionchange', (event: PushSubscriptionChangeEvent) => {
  event.waitUntil((async () => {
    try {
      const oldSub = event.oldSubscription;
      const applicationServerKey =
        (oldSub?.options.applicationServerKey as ArrayBuffer | null) ??
        urlBase64ToUint8Array(await fetchVapidPublicKey());

      const subscription = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });
      const sub = subscription.toJSON();
      await fetch(`${API_BASE_URL}/push/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ endpoint: sub.endpoint, keys: sub.keys }),
      });
    } catch (err) {
      console.error('[SW] pushsubscriptionchange re-subscribe failed:', err);
    }
  })());
});

async function fetchVapidPublicKey(): Promise<string> {
  const res = await fetch(`${API_BASE_URL}/push/vapid-public-key`, { credentials: 'include' });
  const data = await res.json() as { publicKey: string };
  return data.publicKey;
}
