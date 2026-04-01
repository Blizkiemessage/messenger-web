/**
 * push.ts
 * Web Push registration flow:
 *  1. Check/request Notification permission
 *  2. Register service worker
 *  3. Fetch VAPID public key from backend
 *  4. Subscribe via PushManager
 *  5. POST subscription to backend
 */

import apiClient from '../api/client';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    output[i] = rawData.charCodeAt(i);
  }
  return output;
}

export async function registerPush(): Promise<void> {
  try {
    // Bail out if push is not supported
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

    // Request notification permission
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return;

    // Register service worker
    const registration = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;

    // Fetch VAPID public key
    const { data } = await apiClient.get<{ publicKey: string }>('/push/vapid-public-key');
    if (!data?.publicKey) return;

    const applicationServerKey = urlBase64ToUint8Array(data.publicKey);

    // Subscribe (or retrieve existing subscription)
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });
    }

    // Send subscription to backend
    const sub = subscription.toJSON();
    await apiClient.post('/push/subscribe', {
      endpoint: sub.endpoint,
      keys: sub.keys,
    });
  } catch (err) {
    // Non-critical — silently swallow errors
    console.warn('[Push] Registration failed:', err);
  }
}

export async function unregisterPush(): Promise<void> {
  try {
    if (!('serviceWorker' in navigator)) return;
    const registration = await navigator.serviceWorker.getRegistration('/sw.js');
    if (!registration) return;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return;
    const endpoint = subscription.endpoint;
    await subscription.unsubscribe();
    await apiClient.delete('/push/subscribe', { data: { endpoint } });
  } catch (err) {
    console.warn('[Push] Unregister failed:', err);
  }
}
