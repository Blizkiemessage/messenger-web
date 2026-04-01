/* Service Worker — Web Push handler for Blizkie messenger */

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

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      // Focus existing window if already open
      for (const client of list) {
        if ('focus' in client) return client.focus();
      }
      // Otherwise open a new window
      return clients.openWindow('/');
    })
  );
});
