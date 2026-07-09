/**
 * notes/helpers.ts — pure helpers for notes (no React).
 */
import type { SharedNote } from '../../types';
import type { NoteBlock, TextBlock } from './types';

let _seq = 0;
export function uid(): string { return `nb_${Date.now()}_${++_seq}`; }

export function parseBlocks(raw: string): NoteBlock[] {
  if (!raw) return [{ id: uid(), type: 'text', text: '' }];
  try {
    const p = JSON.parse(raw);
    if (Array.isArray(p) && p.length > 0) return p as NoteBlock[];
  } catch { /* fall through */ }
  return [{ id: uid(), type: 'text', text: raw }];
}

export function serialize(blocks: NoteBlock[]): string { return JSON.stringify(blocks); }

export function relTime(ts: number, t: (k: string, o?: any) => string, locale: string): string {
  const d = Date.now() - ts;
  if (d < 60_000) return t('common:justNow');
  const m = Math.floor(d / 60_000);
  if (m < 60) return t('notes:time.minutesAgo', { count: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t('notes:time.hoursAgo', { count: h });
  const days = Math.floor(h / 24);
  if (days < 7) return t('notes:time.daysAgo', { count: days });
  return new Date(ts).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
}

export function fmtSize(b: number | undefined, t: (k: string, o?: any) => string): string {
  if (!b) return '';
  if (b < 1024) return t('modals:collections.sizeBytes', { count: b });
  if (b < 1048576) return t('modals:collections.sizeKB', { count: (b / 1024).toFixed(1) });
  return t('modals:collections.sizeMB', { count: (b / 1048576).toFixed(1) });
}

export function fmtSec(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
}

export function fileColor(name: string): string {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (['jpg','jpeg','png','gif','webp','heic'].includes(ext)) return '#9b59b6';
  if (ext === 'pdf') return '#e74c3c';
  if (['doc','docx'].includes(ext)) return '#2980b9';
  if (['xls','xlsx','csv'].includes(ext)) return '#27ae60';
  if (['zip','rar','7z'].includes(ext)) return '#f39c12';
  if (['mp3','wav','aac','flac','m4a'].includes(ext)) return '#e91e63';
  if (['mp4','avi','mov','mkv','webm'].includes(ext)) return '#c0392b';
  if (['js','ts','py','go','rs','java','c','cpp'].includes(ext)) return '#16a085';
  return '#7d8590';
}

export function fileLabel(name: string): string {
  const ext = (name.split('.').pop() || '').toUpperCase();
  const map: Record<string, string> = {
    JPEG: 'JPG', DOCX: 'DOC', XLSX: 'XLS', WEBM: 'VID', WEBP: 'IMG',
  };
  return map[ext] ?? (ext.length <= 4 ? ext : 'FILE');
}

export function canEdit(note: SharedNote, meId: string): boolean {
  if (note.created_by === meId) return true;
  if (!note.edit_mode || note.edit_mode === 'all') return true;
  return (note.edit_exceptions ?? []).includes(meId);
}

export function snippet(content: string, t: (k: string) => string): string {
  if (!content) return t('notes:empty');
  try {
    const blocks = JSON.parse(content) as NoteBlock[];
    const text = blocks.find(b => b.type === 'text') as TextBlock | undefined;
    const plain = (text?.text ?? '').replace(/\n+/g, ' ').trim();
    return plain.slice(0, 80) || (blocks.length > 1 ? `📎 ${t('notes:attachment')}` : t('notes:empty'));
  } catch {
    return content.replace(/\n+/g, ' ').slice(0, 80);
  }
}
