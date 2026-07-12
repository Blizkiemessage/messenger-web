/**
 * utils/sentry.js — optional external error tracking (docs/STORE_LAUNCH_TZ.md §6).
 *
 * Off by default: without SENTRY_DSN, initSentry() is a no-op and every other
 * export degrades to a harmless no-op too — mirrors the project's convention
 * for optional integrations (AI assistants, S3, VAPID push, ...).
 *
 * Privacy: this project's core invariant is "no message plaintext at rest"
 * (see CLAUDE.md) — that must hold for third-party SaaS too, even more so.
 * scrubEvent() strips request bodies, cookies and auth headers before every
 * event leaves the process, and only ever attaches an opaque user id (never
 * email/username) so a report can be traced back to one account via the
 * admin panel without Sentry itself ever seeing who that account belongs to.
 */
const Sentry = require('@sentry/node');

let initialised = false;

function isEnabled() {
  return !!process.env.SENTRY_DSN;
}

/**
 * Removes anything that could leak private content or credentials from an
 * outgoing Sentry event. Exported separately so it can be unit-tested
 * without a real DSN/network call.
 */
function scrubEvent(event) {
  if (event.request) {
    delete event.request.data;    // request body — may contain message text, passwords, tokens
    delete event.request.cookies;
    if (event.request.headers) {
      delete event.request.headers.authorization;
      delete event.request.headers.Authorization;
      delete event.request.headers.cookie;
      delete event.request.headers.Cookie;
    }
  }
  // Only an opaque id ever gets attached (see setSentryUser below) — this is
  // a second line of defence in case some future code path sets more.
  if (event.user) {
    event.user = event.user.id ? { id: event.user.id } : undefined;
  }
  return event;
}

function initSentry() {
  if (!isEnabled() || initialised) return;
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    // Error tracking only — performance tracing is a separate, unrequested
    // feature that would burn through the free tier's event quota faster.
    tracesSampleRate: 0,
    sendDefaultPii: false,
    beforeSend: scrubEvent,
  });
  initialised = true;
  console.log('[Sentry] Initialised (backend error tracking enabled)');
}

/** Reports an exception. Tags it with an opaque user id only, never email/username. */
function captureException(err, { userId } = {}) {
  if (!isEnabled()) return;
  Sentry.withScope((scope) => {
    if (userId) scope.setUser({ id: userId });
    Sentry.captureException(err);
  });
}

module.exports = { initSentry, captureException, isEnabled, scrubEvent };
