const webpush = require('web-push');

let initialised = false;

function init() {
  if (initialised) return;
  const publicKey  = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const email      = process.env.VAPID_EMAIL || 'mailto:admin@example.com';

  if (!publicKey || !privateKey) {
    console.warn('[WebPush] VAPID keys not set — push notifications disabled');
    return;
  }

  webpush.setVapidDetails(email, publicKey, privateKey);
  initialised = true;
  console.log('[WebPush] VAPID keys initialised');
}

init();

function getVapidPublicKey() {
  return process.env.VAPID_PUBLIC_KEY || null;
}

/**
 * Send a push notification to a subscription.
 * Returns true on success, false if subscription is gone (410).
 * Throws on other errors.
 */
async function sendPush(subscription, payload) {
  if (!initialised) return false;
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload));
    return true;
  } catch (err) {
    if (err.statusCode === 410 || err.statusCode === 404) return false; // expired
    console.error('[WebPush] sendNotification error:', err.message);
    return false;
  }
}

module.exports = { getVapidPublicKey, sendPush };
