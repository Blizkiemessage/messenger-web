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
const logger                         = require('./logger');

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
    logger.warn('[S3Sign]', 'Failed to sign URL', { url, error: err.message });
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

// ── Avatar helpers (24 h TTL — avatars change rarely) ────────────────────────

/** Sign a single avatar URL (24 h TTL). */
const signAvatarUrl = (url) => signUrl(url, 86400);

/**
 * Sign avatar_url in an array of user/member objects.
 * Mutates in place. Returns the same array.
 */
async function signUserAvatars(users) {
  if (!useS3 || !users?.length) return users;
  await Promise.all(
    users.map(async (u) => {
      if (u?.avatar_url) u.avatar_url = await signAvatarUrl(u.avatar_url);
    })
  );
  return users;
}

/**
 * Sign avatar_url and all members' avatar_url inside a chat object.
 * Also signs last_message.attachment_url.
 * Mutates in place. Returns the same object.
 */
async function signFullChatObject(chat) {
  if (!useS3 || !chat) return chat;
  await Promise.all([
    chat.avatar_url
      ? signAvatarUrl(chat.avatar_url).then(s => { chat.avatar_url = s; })
      : Promise.resolve(),
    chat.last_message?.attachment_url
      ? signUrl(chat.last_message.attachment_url).then(s => { chat.last_message.attachment_url = s; })
      : Promise.resolve(),
    signUserAvatars(chat.members || []),
  ]);
  return chat;
}

/**
 * Sign avatar + member avatars + last_message URL in an array of chats.
 * Mutates in place. Returns the same array.
 */
async function signFullChatObjects(chats) {
  if (!useS3 || !chats?.length) return chats;
  await Promise.all(chats.map(signFullChatObject));
  return chats;
}

// ── Sticker / emoji pack helpers ─────────────────────────────────────────────

/**
 * Sign file_url and thumb_url on a sticker/emoji item object.
 * Mutates in place. Returns the same object.
 */
async function signStickerItem(item) {
  if (!useS3 || !item) return item;
  await Promise.all([
    item.file_url  ? signUrl(item.file_url,  3600).then(s => { item.file_url  = s; }) : Promise.resolve(),
    item.thumb_url ? signUrl(item.thumb_url, 3600).then(s => { item.thumb_url = s; }) : Promise.resolve(),
  ]);
  return item;
}

/**
 * Sign file_url and thumb_url in an array of sticker/emoji items.
 * Mutates in place. Returns the same array.
 */
async function signStickerItems(items) {
  if (!useS3 || !items?.length) return items;
  await Promise.all(items.map(signStickerItem));
  return items;
}

/**
 * Sign cover_url on a sticker pack object (24 h TTL).
 * Mutates in place. Returns the same object.
 */
async function signStickerPack(pack) {
  if (!useS3 || !pack?.cover_url) return pack;
  pack.cover_url = await signAvatarUrl(pack.cover_url);
  return pack;
}

/**
 * Sign cover_url in an array of sticker packs.
 * Mutates in place. Returns the same array.
 */
async function signStickerPacks(packs) {
  if (!useS3 || !packs?.length) return packs;
  await Promise.all(packs.map(signStickerPack));
  return packs;
}

module.exports = {
  signUrl,
  signMessageUrls,
  signChatAttachments,
  signSingleChatAttachment,
  signAvatarUrl,
  signUserAvatars,
  signFullChatObject,
  signFullChatObjects,
  signStickerItem,
  signStickerItems,
  signStickerPack,
  signStickerPacks,
};
