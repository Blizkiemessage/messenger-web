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
const path                           = require('path');
const { S3Client, GetObjectCommand, HeadObjectCommand, HeadBucketCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl }               = require('@aws-sdk/s3-request-presigner');
const logger                         = require('./logger');

// ── Safe serving metadata (defence against stored-content XSS) ────────────────
// Objects are uploaded directly to S3 with a client-supplied Content-Type and
// Content-Disposition. A malicious authenticated client could presign an allowed
// extension (e.g. .webp) but PUT actual HTML/SVG bytes with
// `Content-Type: text/html; Content-Disposition: inline`, then open the raw
// object URL → stored XSS / phishing on the storage origin.
//
// We neutralise this at *serve* time, which the server fully controls: every
// presigned GET overrides response-content-type and response-content-disposition
// based on the TRUSTED object key extension (and, for messages, the DB row), so
// whatever bytes/metadata were stored, the browser is told a safe type and forced
// to download anything that isn't a known inline-media format. Requires no change
// to the upload path (zero regression risk for live uploads).
const EXT_MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
  '.webp': 'image/webp', '.heic': 'image/heic', '.heif': 'image/heif', '.bmp': 'image/bmp', '.tiff': 'image/tiff',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.avi': 'video/x-msvideo',
  '.mpeg': 'video/mpeg', '.mkv': 'video/x-matroska', '.webm': 'video/webm',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav',
  '.aac': 'audio/aac', '.flac': 'audio/flac', '.ogg': 'audio/ogg',
};
// Extensions safe to serve inline (rendered media — never executes script).
const INLINE_EXTS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif', '.bmp', '.tiff',
  '.mp4', '.mov', '.avi', '.mpeg', '.mkv', '.webm',
  '.mp3', '.m4a', '.wav', '.aac', '.flac', '.ogg',
]);

/**
 * Derives safe { ResponseContentType, ResponseContentDisposition } for a key.
 * Caller may override either via `opts` (used for messages: accurate content-type
 * by attachment_type + original filename in the disposition). Anything whose
 * extension isn't a known inline-media type is forced to `attachment`, so HTML/SVG
 * can never render inline on the storage origin.
 */
function safeServeOverrides(key, opts = {}) {
  const ext = path.extname(key || '').toLowerCase();
  const isInline = INLINE_EXTS.has(ext);
  const ResponseContentType =
    opts.contentType || (isInline ? (EXT_MIME[ext] || 'application/octet-stream') : 'application/octet-stream');
  const ResponseContentDisposition =
    opts.disposition || (isInline ? 'inline' : 'attachment');
  return { ResponseContentType, ResponseContentDisposition };
}

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
 * Forces a safe response Content-Type + Content-Disposition (see safeServeOverrides).
 * `opts` (optional): { contentType, disposition } to override the ext-derived defaults.
 * Falls back to the original URL if S3 is not configured or URL is not an S3 URL.
 */
async function signUrl(url, expiresIn = 3600, opts = {}) {
  if (!url || !useS3 || !isS3Url(url)) return url;
  try {
    const key = urlToKey(url);
    const { ResponseContentType, ResponseContentDisposition } = safeServeOverrides(key, opts);
    const command = new GetObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key:    key,
      ResponseContentType,
      ResponseContentDisposition,
    });
    return await getSignedUrl(s3, command, { expiresIn });
  } catch (err) {
    logger.warn('[S3Sign]', 'Failed to sign URL', { url, error: err.message });
    return url; // safe fallback — object still loads if bucket is still public
  }
}

/**
 * Returns the actual stored byte size of an S3 object, or null if unknown / not
 * an S3 URL / not configured. Used to enforce the upload size limit server-side
 * at message-accept time (presigned PUT cannot range-limit, and images/videos are
 * compressed client-side AFTER presign, so the declared size can't be signed).
 */
async function headObjectSize(url) {
  if (!url || !useS3 || !isS3Url(url)) return null;
  try {
    const r = await s3.send(new HeadObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key:    urlToKey(url),
    }));
    return typeof r.ContentLength === 'number' ? r.ContentLength : null;
  } catch (err) {
    // HEAD failed (object not yet visible, transient error) → fail open: callers
    // treat null as "size unknown, allow" to avoid blocking legitimate sends.
    logger.warn('[S3Sign]', 'HeadObject failed', { url, error: err.message });
    return null;
  }
}

// Maps a message's attachment_type → accurate inline content-type given the key
// extension, disambiguating extensions shared by audio & video (e.g. .webm).
function messageContentType(attachmentType, ext) {
  const e = (ext || '').toLowerCase();
  if (attachmentType === 'audio') {
    return ({ '.webm': 'audio/webm', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4',
      '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.aac': 'audio/aac', '.flac': 'audio/flac' })[e]
      || 'audio/mpeg';
  }
  return EXT_MIME[e] || null; // image/video/gif → ext map; null → let signUrl default
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
        msg.attachment_url = await signUrl(msg.attachment_url, 3600, messageServeOpts(msg));
      }
      // Also sign inside reply snippets if they carry attachment_url in future
    })
  );
  return messages;
}

// Inline-media attachment types (rendered, never executes script). Everything
// else (documents, archives, unknown) is forced to download with its filename.
const INLINE_ATTACHMENT_TYPES = new Set([
  'image', 'video', 'video_note', 'audio', 'gif_tenor', 'gif_custom', 'sticker',
]);

/** Build per-message safe serve overrides from the trusted DB row. */
function messageServeOpts(msg) {
  const key = isS3Url(msg.attachment_url) ? urlToKey(msg.attachment_url) : (msg.attachment_url || '');
  const ext = path.extname(key).toLowerCase();
  if (INLINE_ATTACHMENT_TYPES.has(msg.attachment_type)) {
    return { contentType: messageContentType(msg.attachment_type, ext) || undefined, disposition: 'inline' };
  }
  // Document / file → force download, preserving the original filename.
  const name = (msg.attachment_name || path.basename(key) || 'file').slice(0, 200);
  return { disposition: `attachment; filename*=UTF-8''${encodeURIComponent(name)}` };
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

// ── Avatar helpers ────────────────────────────────────────────────────────────
// Avatars are stored in a publicly-readable S3 bucket — the upload route already
// returns permanent public URLs (no signing). Signing avatars with a 24h TTL only
// creates an expiry problem: stored URLs in localStorage/React state go stale,
// causing intermittent "avatar not loading" issues.
// → Just return the original URL unchanged for avatars.

/**
 * Sign avatar URLs with a 7-day TTL.
 * Avatars change rarely so a long TTL avoids stale-URL issues in cached state.
 * Falls back to original URL if S3 is not configured.
 */
const signAvatarUrl = (url) => signUrl(url, 7 * 24 * 3600); // 7 days

/**
 * Sign avatar_url for every user in the array (mutates in place).
 */
async function signUserAvatars(users) {
  await Promise.all(users.map(async (u) => {
    if (u.avatar_url) u.avatar_url = await signAvatarUrl(u.avatar_url);
  }));
  return users;
}

/**
 * Sign avatar + member avatars + last_message URL in a single chat object.
 * Mutates in place. Returns the same object.
 */
/**
 * Sign the image URL inside a ChatBg JSON string (type:'image').
 * Returns the JSON string with a signed url, or the input unchanged.
 * 7-day TTL like avatars — backgrounds change rarely.
 */
async function signChatBgJson(json) {
  if (!useS3 || !json) return json;
  try {
    const bg = JSON.parse(json);
    if (bg?.type === 'image' && bg.url) {
      bg.url = await signAvatarUrl(bg.url);
      return JSON.stringify(bg);
    }
  } catch { /* битый JSON — отдаём как есть */ }
  return json;
}

async function signFullChatObject(chat) {
  if (!useS3 || !chat) return chat;
  // Sign group/direct chat avatar
  if (chat.avatar_url) {
    chat.avatar_url = await signAvatarUrl(chat.avatar_url);
  }
  // Sign per-chat background images (shared + personal)
  if (chat.chat_bg)    chat.chat_bg    = await signChatBgJson(chat.chat_bg);
  if (chat.my_chat_bg) chat.my_chat_bg = await signChatBgJson(chat.my_chat_bg);
  // Sign every member's avatar
  if (Array.isArray(chat.members)) {
    await Promise.all(chat.members.map(async (m) => {
      if (m?.avatar_url) m.avatar_url = await signAvatarUrl(m.avatar_url);
    }));
  }
  // Sign last message attachment
  if (chat.last_message?.attachment_url) {
    chat.last_message.attachment_url = await signUrl(chat.last_message.attachment_url);
  }
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

/**
 * Cheap S3 reachability probe for the health-check endpoint.
 * Returns 'not_configured' in local-disk-mode (no S3 env set — not a failure),
 * 'ok' if the bucket answers, 'unavailable' otherwise. Bounded by timeoutMs so
 * a stalled S3 endpoint can't hang the health check.
 */
async function checkS3Health(timeoutMs = 2000) {
  if (!useS3) return 'not_configured';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await s3.send(new HeadBucketCommand({ Bucket: process.env.S3_BUCKET }), { abortSignal: controller.signal });
    return 'ok';
  } catch (err) {
    logger.warn('[Health]', 'S3 check failed', { error: err?.message });
    return 'unavailable';
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  checkS3Health,
  signUrl,
  headObjectSize,
  safeServeOverrides, // exported for unit tests
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
