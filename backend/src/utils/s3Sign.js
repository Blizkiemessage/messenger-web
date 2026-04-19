/**
 * s3Sign.js — Presigned GET URL generator for private S3 objects.
 *
 * Usage:
 *   const { signUrl, signMessageUrls, signChatAttachments } = require('./s3Sign');
 *
 *   // Single URL
 *   const signed = await signUrl(msg.attachment_url);          // valid 1 hour
 *
 *   // Array of messages (mutates attachment_url in place)
 *   await signMessageUrls(messages);
 *
 *   // Array of chats (mutates last_message.attachment_url in place)
 *   await signChatAttachments(chats);
 *
 * Falls back to the original URL if:
 *   - S3 is not configured (local disk mode)
 *   - The URL doesn't start with S3_PUBLIC_URL
 *   - Signing fails for any reason
 */
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl }               = require('@aws-sdk/s3-request-presigner');

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

/** Returns true if the URL points to our S3 bucket. */
function isS3Url(url) {
  if (!url || !process.env.S3_PUBLIC_URL) return false;
  return url.startsWith(process.env.S3_PUBLIC_URL);
}

/** Extracts the object key from a full S3 public URL. */
function urlToKey(url) {
  const base = process.env.S3_PUBLIC_URL.replace(/\/+$/, '');
  return url.slice(base.length + 1);
}

/**
 * Returns a presigned GET URL valid for `expiresIn` seconds (default 1 hour).
 * Falls back to the original URL if S3 is not configured or URL is not an S3 URL.
 */
async function signUrl(url, expiresIn = 3600) {
  if (!url || !useS3 || !isS3Url(url)) return url;
  try {
    const command = new GetObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key:    urlToKey(url),
    });
    return await getSignedUrl(s3, command, { expiresIn });
  } catch (err) {
    console.warn('[S3Sign] Failed to sign URL:', url, err.message);
    return url; // safe fallback — object still loads if bucket is still public
  }
}

/**
 * Signs attachment_url in an array of message objects.
 * Mutates each message in place. Returns the same array.
 */
async function signMessageUrls(messages) {
  if (!useS3 || !messages?.length) return messages;
  await Promise.all(
    messages.map(async (msg) => {
      if (msg?.attachment_url) {
        msg.attachment_url = await signUrl(msg.attachment_url);
      }
      // Also sign inside reply snippets if they carry attachment_url in future
    })
  );
  return messages;
}

/**
 * Signs last_message.attachment_url in an array of chat objects.
 * Mutates in place. Returns the same array.
 */
async function signChatAttachments(chats) {
  if (!useS3 || !chats?.length) return chats;
  await Promise.all(
    chats.map(async (chat) => {
      if (chat?.last_message?.attachment_url) {
        chat.last_message.attachment_url = await signUrl(chat.last_message.attachment_url);
      }
    })
  );
  return chats;
}

/**
 * Signs last_message.attachment_url on a single chat object.
 * Mutates in place. Returns the same object.
 */
async function signSingleChatAttachment(chat) {
  if (!useS3 || !chat?.last_message?.attachment_url) return chat;
  chat.last_message.attachment_url = await signUrl(chat.last_message.attachment_url);
  return chat;
}

module.exports = { signUrl, signMessageUrls, signChatAttachments, signSingleChatAttachment };
