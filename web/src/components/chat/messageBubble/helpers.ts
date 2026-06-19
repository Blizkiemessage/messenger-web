/**
 * messageBubble/helpers.ts — pure helpers shared by MessageBubble parts.
 * No JSX, no React hooks (resolveCustomEmojiUrl reads the store via getState()).
 */
import { useStickerStore } from '../../../store/useStickerStore';

export function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes || bytes === 0) return '';
  if (bytes < 1024)                return `${bytes} B`;
  if (bytes < 1024 * 1024)         return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export interface FileCategory { color: string; bgColor: string; label: string }

export function getFileCategory(name: string): FileCategory {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (['jpg','jpeg','png','gif','webp','svg','heic','bmp','tiff'].includes(ext))
    return { color: '#9b59b6', bgColor: '#9b59b622', label: ext.toUpperCase() };
  if (ext === 'pdf')
    return { color: '#e74c3c', bgColor: '#e74c3c22', label: 'PDF' };
  if (['doc','docx','odt'].includes(ext))
    return { color: '#2980b9', bgColor: '#2980b922', label: 'DOC' };
  if (['xls','xlsx','ods','csv'].includes(ext))
    return { color: '#27ae60', bgColor: '#27ae6022', label: 'XLS' };
  if (['ppt','pptx','odp'].includes(ext))
    return { color: '#e67e22', bgColor: '#e67e2222', label: 'PPT' };
  if (['txt','md','markdown','rtf'].includes(ext))
    return { color: '#7f8c8d', bgColor: '#7f8c8d22', label: 'TXT' };
  if (['js','ts','jsx','tsx','py','java','c','cpp','cs','go','rb','php',
       'html','css','json','xml','yaml','yml','sh','sql','swift','kt','rs'].includes(ext))
    return { color: '#16a085', bgColor: '#16a08522', label: ext.toUpperCase() };
  if (['zip','rar','7z','tar','gz','bz2','xz'].includes(ext))
    return { color: '#f39c12', bgColor: '#f39c1222', label: 'ZIP' };
  if (['mp3','wav','aac','flac','ogg','m4a','wma'].includes(ext))
    return { color: '#e91e63', bgColor: '#e91e6322', label: 'AUD' };
  if (['mp4','avi','mov','mkv','wmv','webm','flv','m4v'].includes(ext))
    return { color: '#c0392b', bgColor: '#c0392b22', label: 'VID' };
  return { color: '#95a5a6', bgColor: '#95a5a622', label: ext.toUpperCase() || 'FILE' };
}

export function downloadFile(url: string, name: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/** Returns true only for same-origin URLs (relative paths or matching origin).
 *  Cross-origin URLs (e.g. S3) cannot be fetched without CORS headers,
 *  but <audio>/<video> elements handle them natively in opaque mode. */
export function isSameOrigin(url: string): boolean {
  if (url.startsWith('/')) return true;
  try { return new URL(url).origin === window.location.origin; } catch { return false; }
}

export function extractFirstUrl(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = text.match(/https?:\/\/[^\s<>"']+/i);
  return m ? m[0] : null;
}

// ── Custom emoji reaction helpers ─────────────────────────────────────────────
const CUSTOM_EMOJI_RE = /^:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):$/;

export function isCustomEmoji(emoji: string): boolean {
  return CUSTOM_EMOJI_RE.test(emoji);
}

export function resolveCustomEmojiUrl(emoji: string): string | null {
  const m = CUSTOM_EMOJI_RE.exec(emoji);
  if (!m) return null;
  const [, packId, itemId] = m;
  const items = useStickerStore.getState().packItems[packId];
  return items?.find(it => it.id === itemId)?.file_url ?? null;
}
