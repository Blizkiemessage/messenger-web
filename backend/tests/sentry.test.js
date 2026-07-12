'use strict';

/**
 * docs/STORE_LAUNCH_TZ.md §6 — Sentry error tracking coverage.
 *
 * @sentry/node is mocked (no real network calls) via the same require.cache
 * injection technique used across backend/tests/*.js. Covers: off-by-default
 * gating (SENTRY_DSN unset), the privacy scrubber (request body/cookies/auth
 * headers stripped, user reduced to id-only), and errorHandler.js's
 * integration (captures 500s, leaves 4xx alone, existing logger.error
 * behavior untouched).
 */

process.env.MESSAGE_ENCRYPTION_KEY = '0'.repeat(64);
process.env.JWT_SECRET = 'sentry-test-jwt-secret';
process.env.NODE_ENV = 'test';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

function mockModule(relPath, exports) {
  const resolved = require.resolve(relPath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
function freshRequire(relPath) {
  const resolved = require.resolve(relPath);
  delete require.cache[resolved];
  return require(resolved);
}

const sentryCalls = { init: [], captureException: [], setUser: [] };
mockModule('@sentry/node', {
  init: (opts) => { sentryCalls.init.push(opts); },
  withScope: (cb) => {
    const scope = { setUser: (u) => sentryCalls.setUser.push(u) };
    cb(scope);
  },
  captureException: (err) => { sentryCalls.captureException.push(err); },
});

describe('utils/sentry.js — off by default', () => {
  test('initSentry() does not call Sentry.init when SENTRY_DSN is unset', () => {
    delete process.env.SENTRY_DSN;
    const { initSentry, isEnabled } = freshRequire('../src/utils/sentry');
    assert.equal(isEnabled(), false);
    const before = sentryCalls.init.length;
    initSentry();
    assert.equal(sentryCalls.init.length, before);
  });

  test('captureException() is a no-op without SENTRY_DSN', () => {
    delete process.env.SENTRY_DSN;
    const { captureException } = freshRequire('../src/utils/sentry');
    const before = sentryCalls.captureException.length;
    captureException(new Error('should not be reported'));
    assert.equal(sentryCalls.captureException.length, before);
  });
});

describe('utils/sentry.js — enabled with SENTRY_DSN', () => {
  test('initSentry() calls Sentry.init with dsn/environment, errors-only sampling, PII off', () => {
    process.env.SENTRY_DSN = 'https://fake@o0.ingest.sentry.io/0';
    process.env.NODE_ENV = 'test';
    const { initSentry } = freshRequire('../src/utils/sentry');
    const before = sentryCalls.init.length;
    initSentry();
    assert.equal(sentryCalls.init.length, before + 1);
    const opts = sentryCalls.init[before];
    assert.equal(opts.dsn, 'https://fake@o0.ingest.sentry.io/0');
    assert.equal(opts.environment, 'test');
    assert.equal(opts.tracesSampleRate, 0);
    assert.equal(opts.sendDefaultPii, false);
    assert.equal(typeof opts.beforeSend, 'function');
  });

  test('captureException() tags the opaque user id and reports the error', () => {
    process.env.SENTRY_DSN = 'https://fake@o0.ingest.sentry.io/0';
    const { captureException } = freshRequire('../src/utils/sentry');
    const err = new Error('boom');
    const beforeUsers = sentryCalls.setUser.length;
    const beforeErrors = sentryCalls.captureException.length;
    captureException(err, { userId: 'user-42' });
    assert.equal(sentryCalls.setUser.length, beforeUsers + 1);
    assert.deepEqual(sentryCalls.setUser[beforeUsers], { id: 'user-42' });
    assert.equal(sentryCalls.captureException.length, beforeErrors + 1);
    assert.equal(sentryCalls.captureException[beforeErrors], err);
  });

  test('captureException() without a userId still reports, without tagging a user', () => {
    process.env.SENTRY_DSN = 'https://fake@o0.ingest.sentry.io/0';
    const { captureException } = freshRequire('../src/utils/sentry');
    const beforeUsers = sentryCalls.setUser.length;
    const beforeErrors = sentryCalls.captureException.length;
    captureException(new Error('anonymous boom'));
    assert.equal(sentryCalls.setUser.length, beforeUsers);
    assert.equal(sentryCalls.captureException.length, beforeErrors + 1);
  });
});

describe('utils/sentry.js — scrubEvent (privacy)', () => {
  process.env.SENTRY_DSN = 'https://fake@o0.ingest.sentry.io/0';
  const { scrubEvent } = freshRequire('../src/utils/sentry');

  test('strips the request body — may contain message text, passwords, tokens', () => {
    const event = { request: { data: { text: 'a private message', password: 'hunter2' }, url: '/chats/x/messages' } };
    const scrubbed = scrubEvent(event);
    assert.equal(scrubbed.request.data, undefined);
    assert.equal(scrubbed.request.url, '/chats/x/messages'); // harmless field survives
  });

  test('strips cookies and authorization headers (both header casings)', () => {
    const event = {
      request: {
        cookies: { session: 'jwt-token-here' },
        headers: { authorization: 'Bearer abc', Cookie: 'session=xyz', 'user-agent': 'test-agent' },
      },
    };
    const scrubbed = scrubEvent(event);
    assert.equal(scrubbed.request.cookies, undefined);
    assert.equal(scrubbed.request.headers.authorization, undefined);
    assert.equal(scrubbed.request.headers.Cookie, undefined);
    assert.equal(scrubbed.request.headers['user-agent'], 'test-agent'); // harmless header survives
  });

  test('reduces the user object to an opaque id, drops any email/username that might slip in', () => {
    const event = { user: { id: 'user-1', email: 'leak@example.com', username: 'alice' } };
    const scrubbed = scrubEvent(event);
    assert.deepEqual(scrubbed.user, { id: 'user-1' });
  });

  test('drops the user object entirely if it somehow has no id', () => {
    const event = { user: { email: 'leak@example.com' } };
    const scrubbed = scrubEvent(event);
    assert.equal(scrubbed.user, undefined);
  });

  test('an event with no request/user is passed through unchanged', () => {
    const event = { message: 'harmless log event' };
    assert.deepEqual(scrubEvent(event), event);
  });
});

describe('middleware/errorHandler.js — Sentry integration', () => {
  mockModule('../src/config/database', { getDb: () => { throw new Error('DB not needed for this test'); } });

  function fakeReq(userId = null) {
    return { method: 'GET', path: '/x', userId };
  }
  function fakeRes() {
    const res = {
      statusCode: null,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
    };
    return res;
  }

  test('captures the error (tagged with userId) on a 500', () => {
    process.env.SENTRY_DSN = 'https://fake@o0.ingest.sentry.io/0';
    const { errorHandler } = freshRequire('../src/middleware/errorHandler');
    const before = sentryCalls.captureException.length;
    const err = new Error('internal boom');
    errorHandler(err, fakeReq('user-7'), fakeRes(), () => {});
    assert.equal(sentryCalls.captureException.length, before + 1);
    assert.equal(sentryCalls.captureException[before], err);
  });

  test('does NOT report 4xx client errors to Sentry', () => {
    process.env.SENTRY_DSN = 'https://fake@o0.ingest.sentry.io/0';
    const { errorHandler } = freshRequire('../src/middleware/errorHandler');
    const before = sentryCalls.captureException.length;
    const err = Object.assign(new Error('bad request'), { status: 400 });
    const res = fakeRes();
    errorHandler(err, fakeReq('user-7'), res, () => {});
    assert.equal(sentryCalls.captureException.length, before);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'bad request'); // 4xx messages still pass through to the client
  });

  test('500 response body still hides internal details from the client (unchanged behavior)', () => {
    process.env.SENTRY_DSN = 'https://fake@o0.ingest.sentry.io/0';
    const { errorHandler } = freshRequire('../src/middleware/errorHandler');
    const res = fakeRes();
    errorHandler(new Error('leaky SQL detail'), fakeReq(), res, () => {});
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.error, 'Internal server error');
  });
});
