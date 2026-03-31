const { S3Client, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const fs   = require('fs');
const path = require('path');

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

async function deleteFromS3(url) {
  if (!url) return;
  if (useS3) {
    if (!isS3Url(url)) return;
    try {
      await s3.send(new DeleteObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: urlToKey(url),
      }));
    } catch (err) {
      console.warn('[S3] Delete failed:', url, err.message);
    }
  } else {
    const filename = url.split('/').pop();
    if (!filename) return;
    const filepath = path.join(__dirname, '../../uploads', filename);
    fs.unlink(filepath, err => {
      if (err && err.code !== 'ENOENT') console.warn('[Local] Delete failed:', filepath, err.message);
    });
  }
}

async function deleteManyFromS3(urls) {
  await Promise.all((urls || []).filter(Boolean).map(deleteFromS3));
}

module.exports = { deleteFromS3, deleteManyFromS3 };
