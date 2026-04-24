'use strict';

// image/svg+xml excluded: XSS vector (SVG can embed scripts).
// text/html excluded: XSS vector.
// application/octet-stream kept only as a browser fallback — some browsers
// report no MIME type for drag-dropped or pasted files. Not a "normal" doc type.
const IMAGE_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'image/heic', 'image/heif', 'image/bmp', 'image/tiff',
];
const AUDIO_TYPES = [
  'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg',
  'audio/wav', 'audio/aac', 'audio/flac', 'audio/x-m4a',
];
const VIDEO_TYPES = [
  'video/mp4', 'video/quicktime', 'video/x-msvideo',
  'video/webm', 'video/mov', 'video/mpeg', 'video/x-matroska',
];
const DOCUMENT_TYPES = [
  // Office
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.presentation',
  // Text / code (text/html intentionally excluded)
  'text/plain', 'text/csv', 'text/markdown', 'text/rtf',
  'application/json', 'application/xml', 'text/xml',
  // Archives
  'application/zip', 'application/x-zip-compressed',
  'application/x-rar-compressed', 'application/vnd.rar',
  'application/x-7z-compressed',
  'application/x-tar', 'application/gzip', 'application/x-bzip2',
  // Browser fallback only — not a "normal" document type
  'application/octet-stream',
];

const ALLOWED_TYPES = new Set([...IMAGE_TYPES, ...VIDEO_TYPES, ...AUDIO_TYPES, ...DOCUMENT_TYPES]);

// Single source of truth: MIME → file extension.
const MIME_TO_EXT = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif',
  'image/webp': '.webp', 'image/heic': '.heic', 'image/heif': '.heif',
  'image/bmp': '.bmp', 'image/tiff': '.tiff',
  'audio/webm': '.webm', 'audio/ogg': '.ogg', 'audio/mp4': '.m4a',
  'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'audio/aac': '.aac',
  'audio/flac': '.flac', 'audio/x-m4a': '.m4a',
  'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/x-msvideo': '.avi',
  'video/webm': '.webm', 'video/mov': '.mov', 'video/mpeg': '.mpeg',
  'video/x-matroska': '.mkv',
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.oasis.opendocument.text': '.odt',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.oasis.opendocument.spreadsheet': '.ods',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'application/vnd.oasis.opendocument.presentation': '.odp',
  'text/plain': '.txt', 'text/csv': '.csv', 'text/markdown': '.md', 'text/rtf': '.rtf',
  'application/json': '.json', 'application/xml': '.xml', 'text/xml': '.xml',
  'application/zip': '.zip', 'application/x-zip-compressed': '.zip',
  'application/x-rar-compressed': '.rar', 'application/vnd.rar': '.rar',
  'application/x-7z-compressed': '.7z',
  'application/x-tar': '.tar', 'application/gzip': '.gz', 'application/x-bzip2': '.bz2',
};

// Direct upload goes through server memory → lower limit.
// Presign goes client→S3 directly; MAX_PRESIGN_SIZE is just a size-hint check.
const MAX_DIRECT_SIZE  = 50  * 1024 * 1024;
const MAX_PRESIGN_SIZE = 100 * 1024 * 1024;

module.exports = {
  IMAGE_TYPES, AUDIO_TYPES, VIDEO_TYPES, DOCUMENT_TYPES,
  ALLOWED_TYPES, MIME_TO_EXT,
  MAX_DIRECT_SIZE, MAX_PRESIGN_SIZE,
};
