/**
 * Shared by utils/push.ts (main thread) and sw.ts (service worker) — both need
 * to turn the VAPID public key string into the raw bytes PushManager.subscribe
 * expects, so the conversion lives in one dependency-free module importable
 * from either context.
 */
export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const output = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; i++) {
    output[i] = rawData.charCodeAt(i);
  }
  return output;
}
