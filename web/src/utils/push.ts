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
import { urlBase64ToUint8Array } from './pushKeyEncoding';

export type PushRegisterResult =
  | { ok: true }
  | { ok: false; reason: 'unsupported' | 'permission-denied' | 'no-vapid-key' | 'error'; error?: unknown };

/**
 * Returns a result instead of swallowing failures silently — callers that
 * care (e.g. the Permissions tab's "reconnect notifications" button) can
 * show the user why push isn't working, instead of it failing invisibly.
 * The fire-and-forget call site in useSocket.ts still just ignores the
 * result, which is fine — it only needs the best-effort attempt.
 */
export async function registerPush(): Promise<PushRegisterResult> {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      return { ok: false, reason: 'unsupported' };
    }

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return { ok: false, reason: 'permission-denied' };

    // SW is registered early in main.tsx; just wait for it to be ready.
    const registration = await navigator.serviceWorker.ready;

    const { data } = await apiClient.get<{ publicKey: string }>('/push/vapid-public-key');
    if (!data?.publicKey) return { ok: false, reason: 'no-vapid-key' };

    const applicationServerKey = urlBase64ToUint8Array(data.publicKey);

    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });
    }

    const sub = subscription.toJSON();
    await apiClient.post('/push/subscribe', {
      endpoint: sub.endpoint,
      keys: sub.keys,
    });
    return { ok: true };
  } catch (err) {
    console.error('[Push] Registration failed:', err);
    return { ok: false, reason: 'error', error: err };
  }
}

/** True if permission is granted AND there's an active PushManager subscription. */
export async function hasActivePushSubscription(): Promise<boolean> {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false;
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    return !!subscription;
  } catch {
    return false;
  }
}

export async function unregisterPush(): Promise<void> {
  try {
    if (!('serviceWorker' in navigator)) return;
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return;
    const endpoint = subscription.endpoint;
    await subscription.unsubscribe();
    await apiClient.delete('/push/subscribe', { data: { endpoint } });
  } catch (err) {
    console.error('[Push] Unregister failed:', err);
  }
}
