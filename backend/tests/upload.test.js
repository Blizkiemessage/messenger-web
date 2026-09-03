'use strict';

/**
 * docs/STORE_LAUNCH_TZ.md §10 — backend upload/presign coverage.
 *
 * Mocks the AWS SDK packages (no real network/S3 calls) via the same
 * require.cache injection technique used across backend/tests/*.js. Covers:
 *   - routes/upload.js: direct POST /upload, presign PUT branch (default),
 *     presign POST branch (UPLOAD_PRESIGN_POST=true), size/mime rejections
 *   - utils/s3Sign.headObjectSize: success, HEAD failure (fail-open), non-S3 URL
 *   - routes/messages.js's attachmentExceedsLimit: the real 413-at-send-time
 *     size enforcement that a presigned PUT URL can't bind on its own
 */

process.env.MESSAGE_ENCRYPTION_KEY = '0'.repeat(64);
process.env.JWT_SECRET = 'upload-test-jwt-secret';
process.env.NODE_ENV = 'test';
process.env.S3_ACCESS_KEY_ID = 'test-access-key';
process.env.S3_SECRET_ACCESS_KEY = 'test-secret-key';
process.env.S3_BUCKET = 'test-bucket';
process.env.S3_PUBLIC_URL = 'https://cdn.example.com/files';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const Database = require('better-sqlite3');
const sharp = require('sharp');

function mockModule(relPath, exports) {
  const resolved = require.resolve(relPath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
function freshRequire(relPath) {
  const resolved = require.resolve(relPath);
  delete require.cache[resolved];
  return require(resolved);
}

// ── Mock AWS SDK ────────────────────────────────────────────────────────────
const s3Calls = { put: [], head: [], headBucket: [] };
let headObjectImpl = async () => ({ ContentLength: 42 });

class MockCommand { constructor(input) { this.input = input; } }
class PutObjectCommand extends MockCommand {}
class GetObjectCommand extends MockCommand {}
class HeadObjectCommand extends MockCommand {}
class HeadBucketCommand extends MockCommand {}

class MockS3Client {
  async send(command) {
    if (command instanceof PutObjectCommand) { s3Calls.put.push(command.input); return {}; }
    if (command instanceof HeadObjectCommand) { s3Calls.head.push(command.input); return headObjectImpl(command.input); }
    if (command instanceof HeadBucketCommand) { s3Calls.headBucket.push(command.input); return {}; }
    if (command instanceof GetObjectCommand) { return {}; }
    throw new Error('Unhandled mock S3 command: ' + command.constructor.name);
  }
}

mockModule('@aws-sdk/client-s3', {
  S3Client: MockS3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, HeadBucketCommand,
});
mockModule('@aws-sdk/s3-request-presigner', {
  getSignedUrl: async (_client, command, opts) => `https://signed.example/${command.input.Key}?exp=${opts.expiresIn}`,
});
const presignedPostCalls = [];
mockModule('@aws-sdk/s3-presigned-post', {
  createPresignedPost: async (_client, params) => {
    presignedPostCalls.push(params);
    return { url: `https://signed.example/post/${params.Bucket}`, fields: { key: params.Key } };
  },
});

const deleteFromS3Calls = [];
mockModule('../src/utils/s3Delete', {
  deleteFromS3: (url) => { deleteFromS3Calls.push(url); },
  deleteManyFromS3: () => {},
});

// ── In-memory DB — just enough for authMiddleware ────────────────────────────
const db = new Database(':memory:');
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE sessions (id TEXT PRIMARY KEY, revoked INTEGER NOT NULL DEFAULT 0, last_used_at INTEGER);
`);
mockModule('../src/config/database', { getDb: () => db });

const { signAccess } = require('../src/utils/jwt');
const token = signAccess({ sub: 'uploader', jti: 'sess-uploader' });
db.prepare('INSERT INTO sessions (id, revoked) VALUES (?, 0)').run('sess-uploader');

function authHeaders(extra = {}) {
  return { Authorization: `Bearer ${token}`, ...extra };
}

// ── Small helper to mount a router on an ephemeral HTTP server ──────────────
async function serve(router, mountPath = '/upload') {
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use(mountPath, router);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  return { server, baseUrl: `http://127.0.0.1:${port}${mountPath}` };
}

let pngBuffer;
before(async () => {
  pngBuffer = await sharp({
    create: { width: 4, height: 4, channels: 3, background: { r: 200, g: 50, b: 50 } },
  }).png().toBuffer();
});

describe('routes/upload.js — POST /upload (direct multipart)', () => {
  let server, baseUrl;
  before(async () => {
    delete process.env.UPLOAD_PRESIGN_POST;
    const router = freshRequire('../src/routes/upload');
    ({ server, baseUrl } = await serve(router));
  });
  after(async () => { await new Promise((r) => server.close(r)); });

  test('uploads and compresses an image via S3 PutObjectCommand', async () => {
    const before = s3Calls.put.length;
    const form = new FormData();
    form.set('file', new Blob([pngBuffer], { type: 'image/png' }), 'photo.png');
    const res = await fetch(baseUrl, { method: 'POST', headers: authHeaders(), body: form });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.type, 'image');
    assert.equal(body.name, 'photo.png');
    assert.equal(s3Calls.put.length, before + 1);
    const putInput = s3Calls.put[before];
    assert.equal(putInput.Bucket, 'test-bucket');
    assert.equal(putInput.ContentType, 'image/webp'); // non-GIF images are recompressed to WebP
    assert.equal(putInput.ContentDisposition, 'inline');
    assert.match(body.url, /^https:\/\/cdn\.example\.com\/files\//);
  });

  test('rejects a disallowed MIME type before touching S3', async () => {
    const before = s3Calls.put.length;
    const form = new FormData();
    form.set('file', new Blob([Buffer.from('<script>alert(1)</script>')], { type: 'text/html' }), 'evil.html');
    const res = await fetch(baseUrl, { method: 'POST', headers: authHeaders(), body: form });
    assert.equal(res.status, 400);
    assert.equal(s3Calls.put.length, before); // no S3 call was made
  });

  test('requires auth', async () => {
    const form = new FormData();
    form.set('file', new Blob([pngBuffer], { type: 'image/png' }), 'photo.png');
    const res = await fetch(baseUrl, { method: 'POST', body: form });
    assert.equal(res.status, 401);
  });
});

describe('routes/upload.js — POST /upload/presign (PUT branch, default)', () => {
  let server, baseUrl;
  before(async () => {
    delete process.env.UPLOAD_PRESIGN_POST;
    const router = freshRequire('../src/routes/upload');
    ({ server, baseUrl } = await serve(router));
  });
  after(async () => { await new Promise((r) => server.close(r)); });

  test('returns a PUT presign for an allowed image type, inline disposition', async () => {
    const res = await fetch(`${baseUrl}/presign`, {
      method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ mime: 'image/png', size: 1024, filename: 'photo.png' }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.method, 'PUT');
    assert.match(body.uploadUrl, /^https:\/\/signed\.example\//);
    assert.match(body.fileUrl, /^https:\/\/cdn\.example\.com\/files\//);
    assert.equal(body.contentDisposition, 'inline');
  });

  test('forces attachment disposition for document types', async () => {
    const res = await fetch(`${baseUrl}/presign`, {
      method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ mime: 'application/pdf', size: 1024, filename: 'contract.pdf' }),
    });
    const body = await res.json();
    assert.match(body.contentDisposition, /^attachment;/);
    assert.match(body.contentDisposition, /contract\.pdf/);
  });

  test('rejects a request declaring a size over MAX_PRESIGN_SIZE', async () => {
    const res = await fetch(`${baseUrl}/presign`, {
      method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ mime: 'video/mp4', size: 200 * 1024 * 1024, filename: 'big.mp4' }),
    });
    assert.equal(res.status, 400);
  });

  test('rejects a disallowed MIME type', async () => {
    const res = await fetch(`${baseUrl}/presign`, {
      method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ mime: 'text/html', size: 100, filename: 'x.html' }),
    });
    assert.equal(res.status, 400);
  });
});

describe('routes/upload.js — POST /upload/presign (POST branch, UPLOAD_PRESIGN_POST=true)', () => {
  let server, baseUrl;
  before(async () => {
    process.env.UPLOAD_PRESIGN_POST = 'true';
    const router = freshRequire('../src/routes/upload');
    ({ server, baseUrl } = await serve(router));
  });
  after(async () => {
    delete process.env.UPLOAD_PRESIGN_POST;
    await new Promise((r) => server.close(r));
  });

  test('returns a presigned POST policy binding content-length-range', async () => {
    const before = presignedPostCalls.length;
    const res = await fetch(`${baseUrl}/presign`, {
      method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ mime: 'image/jpeg', size: 2048, filename: 'a.jpg' }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.method, 'POST');
    assert.ok(body.fields);
    assert.match(body.uploadUrl, /^https:\/\/signed\.example\/post\//);

    assert.equal(presignedPostCalls.length, before + 1);
    const params = presignedPostCalls[before];
    assert.equal(params.Bucket, 'test-bucket');
    const sizeCondition = params.Conditions.find((c) => Array.isArray(c) && c[0] === 'content-length-range');
    assert.deepEqual(sizeCondition, ['content-length-range', 1, 100 * 1024 * 1024]);
  });
});

describe('utils/s3Sign.headObjectSize', () => {
  const { headObjectSize } = require('../src/utils/s3Sign');
  const s3Url = 'https://cdn.example.com/files/some-key.mp4';

  test('returns the object size on a successful HEAD', async () => {
    headObjectImpl = async () => ({ ContentLength: 987654 });
    const size = await headObjectSize(s3Url);
    assert.equal(size, 987654);
  });

  test('fails open (returns null) when HEAD throws', async () => {
    headObjectImpl = async () => { throw new Error('simulated S3 outage'); };
    const size = await headObjectSize(s3Url);
    assert.equal(size, null);
  });

  test('returns null for a URL outside the configured bucket, without calling S3', async () => {
    const before = s3Calls.head.length;
    const size = await headObjectSize('https://not-our-bucket.example.com/x.mp4');
    assert.equal(size, null);
    assert.equal(s3Calls.head.length, before);
  });
});

describe('routes/messages.js — attachmentExceedsLimit (413 size enforcement)', () => {
  const messagesRouter = require('../src/routes/messages');
  const { attachmentExceedsLimit } = messagesRouter;
  const s3Url = 'https://cdn.example.com/files/big-video.mp4';

  test('returns true and deletes the orphan when the stored object exceeds MAX_PRESIGN_SIZE', async () => {
    headObjectImpl = async () => ({ ContentLength: 101 * 1024 * 1024 });
    const before = deleteFromS3Calls.length;
    const exceeds = await attachmentExceedsLimit(s3Url);
    assert.equal(exceeds, true);
    assert.equal(deleteFromS3Calls.length, before + 1);
    assert.equal(deleteFromS3Calls[before], s3Url);
  });

  test('returns false when the stored object is within the limit', async () => {
    headObjectImpl = async () => ({ ContentLength: 1024 });
    const before = deleteFromS3Calls.length;
    const exceeds = await attachmentExceedsLimit(s3Url);
    assert.equal(exceeds, false);
    assert.equal(deleteFromS3Calls.length, before);
  });

  test('fails open (false) when HEAD fails — a transient S3 hiccup never blocks a send', async () => {
    headObjectImpl = async () => { throw new Error('simulated S3 outage'); };
    const exceeds = await attachmentExceedsLimit(s3Url);
    assert.equal(exceeds, false);
  });
});

// ── QA-прогон 2026-09-03 (docs/QA_FUNCTIONAL_MAP.md §2) ──────────────────────
// Headers for the local-disk fallback at GET /uploads/<file>. helmet()'s global
// default sets `Cross-Origin-Resource-Policy: same-origin` on every response,
// which blocks <img>/<video>/<audio> embedding from another origin REGARDLESS of
// CORS — and the frontend is always on another origin here (Vercel ↔ Amvera in
// production, :5173 ↔ :3000 in dev), so every uploaded image rendered as a
// broken file card with ERR_BLOCKED_BY_RESPONSE.NotSameOrigin.
// The hook lives in utils/staticHeaders.js precisely so it stays testable —
// index.js boots a real server and cannot be required here.
describe('utils/staticHeaders.setUploadHeaders — /uploads response headers', () => {
  const { setUploadHeaders } = require('../src/utils/staticHeaders');

  function headersFor(filePath) {
    const set = {};
    setUploadHeaders({ setHeader: (k, v) => { set[k] = v; } }, filePath);
    return set;
  }

  test('media is embeddable cross-origin and served inline', () => {
    for (const file of ['photo.webp', 'clip.mp4', 'voice.webm', 'pic.JPG']) {
      const h = headersFor(`/srv/uploads/${file}`);
      assert.equal(h['Cross-Origin-Resource-Policy'], 'cross-origin', `${file} must be embeddable`);
      assert.equal(h['X-Content-Type-Options'], 'nosniff');
      assert.equal(h['Content-Disposition'], undefined, `${file} must not be forced to download`);
    }
  });

  test('non-media is still forced to download and never sniffed (XSS guard intact)', () => {
    for (const file of ['payload.html', 'vector.svg', 'doc.pdf', 'archive.zip']) {
      const h = headersFor(`/srv/uploads/${file}`);
      assert.equal(h['Content-Disposition'], 'attachment', `${file} must download, not render`);
      assert.equal(h['X-Content-Type-Options'], 'nosniff');
    }
  });

  test('CORP is never left at the same-origin default that blocked media', () => {
    const h = headersFor('/srv/uploads/anything.bin');
    assert.notEqual(h['Cross-Origin-Resource-Policy'], 'same-origin');
  });
});
