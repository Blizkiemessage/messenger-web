/**
 * utils/sentry.ts — optional external error tracking (docs/STORE_LAUNCH_TZ.md §6).
 *
 * Despite the filename/SDK, the actual ingest endpoint is NOT sentry.io — see
 * the long comment in backend/src/utils/sentry.js for why (Sentry blocked RF
 * users 2024-09-10; VITE_SENTRY_DSN should point at a Sentry-protocol-
 * compatible provider reachable from Russia, e.g. Hawk/hawk-tracker.ru).
 *
 * Off by default: without VITE_SENTRY_DSN, initSentry() is a no-op and every
 * other export degrades to a harmless no-op too — mirrors backend/src/utils/sentry.js.
 *
 * VITE_SENTRY_DSN is NOT a secret the way an API key is — a Sentry-protocol
 * client DSN is a write-only ingest endpoint designed to ship inside public
 * browser bundles (every site using this protocol does this). Fine as a VITE_* var.
 *
 * Privacy: mirrors the backend's scrubEvent — strips request bodies, cookies
 * and auth headers, and only ever attaches an opaque user id (never email/
 * username) so a report can be traced back to one account via the admin
 * panel without the error-tracking provider itself seeing who that account
 * belongs to.
 */
import * as Sentry from '@sentry/react';

let initialised = false;

export function isSentryEnabled(): boolean {
  return !!import.meta.env.VITE_SENTRY_DSN;
}

/** Exported separately so it can be unit-tested without a real DSN/network call. */
export function scrubEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    if (event.request.headers) {
      delete event.request.headers.authorization;
      delete event.request.headers.Authorization;
      delete event.request.headers.cookie;
      delete event.request.headers.Cookie;
    }
  }
  if (event.user) {
    event.user = event.user.id ? { id: event.user.id } : undefined;
  }
  return event;
}

export function initSentry(): void {
  if (!isSentryEnabled() || initialised) return;
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.PROD ? 'production' : 'development',
    // Error tracking only — no performance tracing, no session replay
    // (replay in particular would risk capturing on-screen message text).
    tracesSampleRate: 0,
    sendDefaultPii: false,
    beforeSend: scrubEvent,
  });
  initialised = true;
}

/** Reports a caught React render error (called from ErrorBoundary). */
export function captureReactError(error: Error, componentStack?: string | null): void {
  if (!isSentryEnabled()) return;
  Sentry.captureException(error, {
    contexts: componentStack ? { react: { componentStack } } : undefined,
  });
}

/** Tags subsequent events with an opaque user id only — never email/username. */
export function setSentryUser(userId: string): void {
  if (!isSentryEnabled()) return;
  Sentry.setUser({ id: userId });
}

export function clearSentryUser(): void {
  if (!isSentryEnabled()) return;
  Sentry.setUser(null);
}
