const { S3Client, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const fs     = require('fs');
const path   = require('path');
const logger = require('./logger');

const useS3 = !!(
  process.env.S3_ACCESS_KEY_ID &&
  process.env.S3_SECRET_ACCESS_KEY &&
  process.env.S3_BUCKET &&
  process.env.S3_PUBLIC_URL
);

let s3;
if (useS3) {
  s3 = new S3Client({
    region:   process.env.S3_REGION   || 'ru-central1',
    endpoint: process.env.S3_ENDPOINT || 'https://storage.yandexcloud.net',
    credentials: {
      accessKeyId:     process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    },
  });
}

function isS3Url(url) {
  if (!url || !process.env.S3_PUBLIC_URL) return false;
  return url.startsWith(process.env.S3_PUBLIC_URL);
}

function urlToKey(url) {
  const base = process.env.S3_PUBLIC_URL.replace(/\/+$/, '');
  return url.slice(base.length + 1);
}

// Retry S3 deletes with exponential backoff: 300 ms → 900 ms → 2700 ms.
// Transient Yandex S3 errors (503, network blip) are recovered automatically.
// Final failure is logged at error level so it surfaces in the admin panel.
const S3_DELETE_ATTEMPTS = 3;

async function deleteFromS3(url) {
  if (!url) return;

  if (useS3) {
    if (!isS3Url(url)) return;
    const key = urlToKey(url);
    let lastErr;

    for (let attempt = 1; attempt <= S3_DELETE_ATTEMPTS; attempt++) {
      try {
        await s3.send(new DeleteObjectCommand({
          Bucket: process.env.S3_BUCKET,
          Key:    key,
        }));
        return; // success
      } catch (err) {
        lastErr = err;
        if (attempt < S3_DELETE_ATTEMPTS) {
          const delay = 300 * 3 ** (attempt - 1); // 300 ms, 900 ms, 2700 ms
          logger.warn('[S3Delete]', `Delete attempt ${attempt} failed — retrying in ${delay} ms`, {
            key, error: err.message,
          });
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }

    logger.error('[S3Delete]', `Failed to delete object after ${S3_DELETE_ATTEMPTS} attempts`, lastErr, {
      key,
    });
    // Hand off to the persistent queue so the next cleanup cycle retries it.
    // Lazy-require avoids a circular dep at module load time.
    try {
      require('../workers/s3Cleanup').enqueueDelete(key);
    } catch (qErr) {
      logger.warn('[S3Delete]', 'Failed to enqueue key for deferred delete', { key, error: qErr.message });
    }
  } else {
    const filename = url.split('/').pop();
    if (!filename) return;
    const filepath = path.join(__dirname, '../../uploads', filename);
    fs.unlink(filepath, err => {
      if (err && err.code !== 'ENOENT') {
        logger.warn('[S3Delete]', 'Failed to delete local file', { url: filepath, error: err.message });
      }
    });
  }
}

async function deleteManyFromS3(urls) {
  const valid = (urls || []).filter(u => u && typeof u === 'string');
  if (!valid.length) return;
  await Promise.allSettled(valid.map(url =>
    deleteFromS3(url).catch(err =>
      logger.warn('[S3Delete]', 'Failed to delete object in batch', { url, error: err.message })
    )
  ));
}

module.exports = { deleteFromS3, deleteManyFromS3 };
