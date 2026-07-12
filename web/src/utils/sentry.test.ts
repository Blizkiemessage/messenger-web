import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * docs/STORE_LAUNCH_TZ.md §6 — Sentry error tracking coverage (frontend).
 * @sentry/react is mocked (no real network calls). Mirrors
 * backend/tests/sentry.test.js's scope: off-by-default gating, the privacy
 * scrubber, and that captured errors are tagged with an opaque user id only.
 */

const sentryCalls = { init: [] as any[], captureException: [] as any[], setUser: [] as any[] };

vi.mock('@sentry/react', () => ({
  init: (opts: any) => { sentryCalls.init.push(opts); },
  captureException: (err: any, ctx: any) => { sentryCalls.captureException.push({ err, ctx }); },
  setUser: (u: any) => { sentryCalls.setUser.push(u); },
}));

beforeEach(() => {
  sentryCalls.init.length = 0;
  sentryCalls.captureException.length = 0;
  sentryCalls.setUser.length = 0;
  vi.unstubAllEnvs();
  vi.resetModules();
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('utils/sentry.ts — off by default', () => {
  it('initSentry() does not call Sentry.init when VITE_SENTRY_DSN is unset', async () => {
    const { initSentry, isSentryEnabled } = await import('./sentry');
    expect(isSentryEnabled()).toBe(false);
    initSentry();
    expect(sentryCalls.init.length).toBe(0);
  });

  it('captureReactError() and setSentryUser() are no-ops without a DSN', async () => {
    const { captureReactError, setSentryUser } = await import('./sentry');
    captureReactError(new Error('should not be reported'), 'stack');
    setSentryUser('user-1');
    expect(sentryCalls.captureException.length).toBe(0);
    expect(sentryCalls.setUser.length).toBe(0);
  });
});

describe('utils/sentry.ts — enabled with VITE_SENTRY_DSN', () => {
  it('initSentry() calls Sentry.init with errors-only sampling and PII off', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://fake@o0.ingest.sentry.io/0');
    const { initSentry, isSentryEnabled } = await import('./sentry');
    expect(isSentryEnabled()).toBe(true);
    initSentry();
    expect(sentryCalls.init.length).toBe(1);
    expect(sentryCalls.init[0].dsn).toBe('https://fake@o0.ingest.sentry.io/0');
    expect(sentryCalls.init[0].tracesSampleRate).toBe(0);
    expect(sentryCalls.init[0].sendDefaultPii).toBe(false);
    expect(typeof sentryCalls.init[0].beforeSend).toBe('function');
  });

  it('captureReactError() reports with the component stack attached', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://fake@o0.ingest.sentry.io/0');
    const { captureReactError } = await import('./sentry');
    const err = new Error('render boom');
    captureReactError(err, 'in MessageBubble');
    expect(sentryCalls.captureException.length).toBe(1);
    expect(sentryCalls.captureException[0].err).toBe(err);
    expect(sentryCalls.captureException[0].ctx.contexts.react.componentStack).toBe('in MessageBubble');
  });

  it('setSentryUser() tags an opaque id; clearSentryUser() clears it', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://fake@o0.ingest.sentry.io/0');
    const { setSentryUser, clearSentryUser } = await import('./sentry');
    setSentryUser('user-42');
    expect(sentryCalls.setUser[0]).toEqual({ id: 'user-42' });
    clearSentryUser();
    expect(sentryCalls.setUser[1]).toBe(null);
  });
});

describe('utils/sentry.ts — scrubEvent (privacy)', () => {
  it('strips the request body — may contain message text, passwords, tokens', async () => {
    const { scrubEvent } = await import('./sentry');
    const event: any = { request: { data: { text: 'a private message' }, url: '/api/x' } };
    const scrubbed = scrubEvent(event);
    expect(scrubbed.request!.data).toBeUndefined();
    expect(scrubbed.request!.url).toBe('/api/x');
  });

  it('strips cookies and authorization headers (both casings)', async () => {
    const { scrubEvent } = await import('./sentry');
    const event: any = {
      request: {
        cookies: { session: 'jwt-token' },
        headers: { authorization: 'Bearer abc', Cookie: 'session=xyz', 'user-agent': 'test' },
      },
    };
    const scrubbed = scrubEvent(event);
    expect(scrubbed.request!.cookies).toBeUndefined();
    expect((scrubbed.request!.headers as any).authorization).toBeUndefined();
    expect((scrubbed.request!.headers as any).Cookie).toBeUndefined();
    expect((scrubbed.request!.headers as any)['user-agent']).toBe('test');
  });

  it('reduces the user object to an opaque id, drops email/username', async () => {
    const { scrubEvent } = await import('./sentry');
    const event: any = { user: { id: 'user-1', email: 'leak@example.com', username: 'alice' } };
    const scrubbed = scrubEvent(event);
    expect(scrubbed.user).toEqual({ id: 'user-1' });
  });
});
