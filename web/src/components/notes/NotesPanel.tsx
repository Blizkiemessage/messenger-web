/**
 * NotesPanel — F4: Shared notes for a chat.
 *
 * Rich block-based editor:
 *   - Text blocks (auto-resizing textareas)
 *   - Images (click to lightbox)
 *   - Videos (inline player with progress bar)
 *   - Files (download card)
 *   - GIFs & Stickers (inline)
 *   - Emoji / custom emoji (inserted at cursor)
 *   - File upload via existing pipeline
 *   - Clipboard paste (images, files)
 *   - Auto-save with debounce
 *   - Realtime sync via socket
 */

import {
  useState, useEffect, useRef, useCallback, lazy, Suspense,
} from 'react';
import { createPortal } from 'react-dom';
import type { SharedNote, Chat } from '../../types';
import { useNotesStore } from '../../store/useNotesStore';
import { createNote, updateNote, deleteNote } from '../../api/notes';
import { useSessionStore } from '../../store/useSessionStore';
import { useAppStore } from '../../store/useAppStore';
import { uploadFile } from '../../api/upload';

const EmojiStickerPanel = lazy(() =>
  import('../chat/EmojiStickerPanel').then(m => ({ default: m.EmojiStickerPanel }))
);

// ─── Content block types ──────────────────────────────────────────────────────

type TextBlock    = { id: string; type: 'text'; text: string };
type ImageBlock   = { id: string; type: 'image'; url: string; name: string; size?: number };
type VideoBlock_  = { id: string; type: 'video'; url: string; name: string; size?: number };
type FileBlock    = { id: string; type: 'file';  url: string; name: string; size?: number };
type GifBlock     = { id: string; type: 'gif';   url: string };
type StickerBlock = { id: string; type: 'sticker'; url: string; packId?: string; itemId?: string };

type NoteBlock = TextBlock | ImageBlock | VideoBlock_ | FileBlock | GifBlock | StickerBlock;

// ─── Utilities ────────────────────────────────────────────────────────────────

let _seq = 0;
function uid(): string { return `nb_${Date.now()}_${++_seq}`; }

function parseBlocks(raw: string): NoteBlock[] {
  if (!raw) return [{ id: uid(), type: 'text', text: '' }];
  try {
    const p = JSON.parse(raw);
    if (Array.isArray(p) && p.length > 0) return p as NoteBlock[];
  } catch { /* fall through */ }
  return [{ id: uid(), type: 'text', text: raw }];
}

function serialize(blocks: NoteBlock[]): string { return JSON.stringify(blocks); }

function relTime(ts: number): string {
  const d = Date.now() - ts;
  if (d < 60_000) return 'только что';
  const m = Math.floor(d / 60_000);
  if (m < 60) return `${m} мин. назад`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ч. назад`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days} дн. назад`;
  return new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

function fmtSize(b?: number): string {
  if (!b) return '';
  if (b < 1024) return `${b} Б`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} КБ`;
  return `${(b / 1048576).toFixed(1)} МБ`;
}

function fmtSec(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
}

function fileColor(name: string): string {
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

function fileLabel(name: string): string {
  const ext = (name.split('.').pop() || '').toUpperCase();
  const map: Record<string, string> = {
    JPEG: 'JPG', DOCX: 'DOC', XLSX: 'XLS', WEBM: 'VID', WEBP: 'IMG',
  };
  return map[ext] ?? (ext.length <= 4 ? ext : 'FILE');
}

// ─── Small shared components ──────────────────────────────────────────────────

function FileIcon({ name }: { name: string }) {
  const c = fileColor(name);
  const l = fileLabel(name);
  return (
    <div className="nfIcon" style={{ background: c + '22', borderColor: c + '55' }}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
          fill={c + '33'} stroke={c} strokeWidth="1.6" strokeLinecap="round"/>
        <polyline points="14 2 14 8 20 8" stroke={c} strokeWidth="1.6" strokeLinecap="round"/>
      </svg>
      <span style={{ color: c, fontSize: l.length > 3 ? 8 : 9 }}>{l}</span>
    </div>
  );
}

function DeleteBlockBtn({ onClick }: { onClick: () => void }) {
  return (
    <button className="noteBlockDel" onClick={onClick} title="Удалить">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>
  );
}

// ─── Image lightbox ───────────────────────────────────────────────────────────

function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);
  return createPortal(
    <div className="noteLightbox" onClick={onClose}>
      <button className="noteLightboxClose" onClick={onClose}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
      <img src={src} className="noteLightboxImg" onClick={e => e.stopPropagation()} alt="" draggable={false} />
    </div>,
    document.body,
  );
}

// ─── Inline video player ──────────────────────────────────────────────────────

function NoteVideoBlock({ block, onDelete, readOnly }: { block: VideoBlock_; onDelete: () => void; readOnly?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dur, setDur] = useState(0);

  function toggle() {
    const v = ref.current; if (!v) return;
    v.paused ? v.play().then(() => setPlaying(true)).catch(() => {}) : (v.pause(), setPlaying(false));
  }
  function seek(e: React.MouseEvent<HTMLDivElement>) {
    const v = ref.current; if (!v || !v.duration) return;
    const r = e.currentTarget.getBoundingClientRect();
    v.currentTime = ((e.clientX - r.left) / r.width) * v.duration;
  }

  return (
    <div className="noteVideoWrap">
      {!readOnly && <DeleteBlockBtn onClick={onDelete} />}
      <video
        ref={ref} src={block.url} className="noteVideoEl" preload="metadata" playsInline
        onLoadedMetadata={() => setDur(ref.current?.duration ?? 0)}
        onTimeUpdate={() => {
          const v = ref.current;
          if (v?.duration) setProgress((v.currentTime / v.duration) * 100);
        }}
        onEnded={() => setPlaying(false)}
      />
      <div className="noteVideoControls">
        <button className="noteVideoPlayBtn" onClick={toggle}>
          {playing
            ? <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
            : <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          }
        </button>
        <div className="noteVideoSeek" onClick={seek}>
          <div className="noteVideoFill" style={{ width: `${progress}%` }} />
        </div>
        <span className="noteVideoDur">{fmtSec(dur)}</span>
      </div>
      <div className="noteVideoName">{block.name}</div>
    </div>
  );
}

// ─── Media block renderer ─────────────────────────────────────────────────────

function MediaBlock({ block, onDelete, readOnly }: { block: NoteBlock; onDelete: () => void; readOnly?: boolean }) {
  const [lb, setLb] = useState<string | null>(null);
  if (block.type === 'text') return null;
  if (block.type === 'video') return <NoteVideoBlock block={block} onDelete={onDelete} readOnly={readOnly} />;
  if (block.type === 'sticker') return (
    <div className="noteStickerWrap">
      {!readOnly && <DeleteBlockBtn onClick={onDelete} />}
      <img src={block.url} className="noteStickerImg" alt="sticker" />
    </div>
  );
  if (block.type === 'image' || block.type === 'gif') return (
    <div className="noteImgWrap">
      {!readOnly && <DeleteBlockBtn onClick={onDelete} />}
      <img
        src={block.url}
        className={`noteBlockImg${block.type === 'gif' ? ' noteBlockGif' : ''}`}
        alt={block.type === 'gif' ? 'GIF' : (block as ImageBlock).name}
        onClick={() => setLb(block.url)}
      />
      {lb && <Lightbox src={lb} onClose={() => setLb(null)} />}
    </div>
  );
  if (block.type === 'file') return (
    <div className="noteFileWrap">
      {!readOnly && <DeleteBlockBtn onClick={onDelete} />}
      <FileIcon name={block.name} />
      <div className="nfInfo">
        <div className="nfName">{block.name}</div>
        <div className="nfSize">{fmtSize(block.size)}</div>
      </div>
      <a href={block.url} download={block.name} className="nfDown" title="Скачать" onClick={e => e.stopPropagation()}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
      </a>
    </div>
  );
  return null;
}

// ─── Upload progress bar ──────────────────────────────────────────────────────

function UploadBar({ pct }: { pct: number }) {
  return (
    <div className="noteUploadBar">
      <div className="noteUploadFill" style={{ width: `${pct}%` }} />
      <span className="noteUploadLabel">Загрузка {pct}%</span>
    </div>
  );
}

// ─── Rich text editor ─────────────────────────────────────────────────────────

interface EditorProps {
  note: SharedNote;
  chat: Chat;
  meId: string;
  onBack: () => void;
  onDelete: (noteId: string) => void;
}

function NoteEditor({ note, chat, meId, onBack, onDelete }: EditorProps) {
  const theme = useAppStore(s => s.theme);
  const upsertNote = useNotesStore(s => s.upsertNote);

  const [title, setTitle]   = useState(note.title);
  const [blocks, setBlocks] = useState<NoteBlock[]>(() => parseBlocks(note.content));
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(note.last_edited_at);
  const [confirmDel, setConfirmDel]   = useState(false);
  const [showEmoji, setShowEmoji]     = useState(false);
  const [uploadPct, setUploadPct]     = useState<number | null>(null);

  const saveTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendTitle   = useRef(title);
  const pendBlocks  = useRef(blocks);
  const activeId    = useRef<string | null>(null);   // focused text block id
  const activeCursor = useRef<number>(0);             // cursor position in that block
  const taRefs      = useRef<Map<string, HTMLTextAreaElement>>(new Map());
  const fileRef     = useRef<HTMLInputElement>(null);
  const emojiRef    = useRef<HTMLDivElement>(null);
  const emojiBtnRef = useRef<HTMLButtonElement>(null);

  // Sync pending refs
  useEffect(() => { pendTitle.current  = title;  }, [title]);
  useEffect(() => { pendBlocks.current = blocks; }, [blocks]);

  const doSave = useCallback(async () => {
    setSaving(true);
    try {
      const updated = await updateNote(chat.id, note.id, {
        title: pendTitle.current,
        content: serialize(pendBlocks.current),
      });
      upsertNote(chat.id, updated);
      setSavedAt(updated.last_edited_at);
    } catch { /* silent */ }
    setSaving(false);
  }, [chat.id, note.id, upsertNote]);

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(doSave, 800);
  }, [doSave]);

  // Flush on unmount
  useEffect(() => () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      updateNote(chat.id, note.id, {
        title: pendTitle.current,
        content: serialize(pendBlocks.current),
      }).then(u => upsertNote(chat.id, u)).catch(() => {});
    }
  }, [chat.id, note.id, upsertNote]); // eslint-disable-line

  // Close emoji panel on outside click
  useEffect(() => {
    if (!showEmoji) return;
    const h = (e: MouseEvent) => {
      const t = e.target as Node;
      if (emojiRef.current?.contains(t) || emojiBtnRef.current?.contains(t)) return;
      setShowEmoji(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [showEmoji]);

  // Auto-resize all textareas whenever blocks change
  useEffect(() => {
    for (const [, el] of taRefs.current) {
      el.style.height = 'auto';
      el.style.height = el.scrollHeight + 'px';
    }
  }, [blocks]);

  // ── Block operations ────────────────────────────────────────────────────────

  const updateText = useCallback((id: string, text: string) => {
    setBlocks(prev => prev.map(b => b.id === id && b.type === 'text' ? { ...b, text } : b));
    scheduleSave();
  }, [scheduleSave]);

  const deleteBlock = useCallback((id: string) => {
    setBlocks(prev => {
      const filtered = prev.filter(b => b.id !== id);
      if (filtered.length === 0) return [{ id: uid(), type: 'text', text: '' }];
      // Merge adjacent text blocks after media removal
      const merged: NoteBlock[] = [];
      for (const blk of filtered) {
        const last = merged[merged.length - 1];
        if (blk.type === 'text' && last?.type === 'text') {
          merged[merged.length - 1] = { ...last, text: last.text + blk.text };
        } else {
          merged.push(blk);
        }
      }
      return merged;
    });
    scheduleSave();
  }, [scheduleSave]);

  // Insert a media block at/after the current cursor position
  const insertBlock = useCallback((newBlk: NoteBlock) => {
    setBlocks(prev => {
      const curId = activeId.current;
      const curIdx = curId ? prev.findIndex(b => b.id === curId) : prev.length - 1;
      const curBlk = prev[curIdx];
      const afterId = uid();

      if (curBlk?.type === 'text') {
        const pos = activeCursor.current;
        const before = curBlk.text.slice(0, pos);
        const after  = curBlk.text.slice(pos);
        const next: NoteBlock[] = [
          ...prev.slice(0, curIdx),
          { ...curBlk, text: before },
          newBlk,
          { id: afterId, type: 'text', text: after },
          ...prev.slice(curIdx + 1),
        ];
        setTimeout(() => {
          const el = taRefs.current.get(afterId);
          if (el) { el.focus(); el.setSelectionRange(0, 0); }
        }, 40);
        return next;
      }

      const insertAt = curIdx >= 0 ? curIdx + 1 : prev.length;
      const next: NoteBlock[] = [
        ...prev.slice(0, insertAt),
        newBlk,
        { id: afterId, type: 'text', text: '' },
        ...prev.slice(insertAt),
      ];
      setTimeout(() => { taRefs.current.get(afterId)?.focus(); }, 40);
      return next;
    });
    scheduleSave();
  }, [scheduleSave]);

  // Backspace at start of text block — merge with prev or delete prev media
  const handleTextKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>, blockId: string) => {
    if (e.key !== 'Backspace') return;
    const ta = e.currentTarget;
    if (ta.selectionStart !== 0 || ta.selectionEnd !== 0) return;
    e.preventDefault();
    setBlocks(prev => {
      const idx = prev.findIndex(b => b.id === blockId);
      if (idx === 0) return prev;
      const prevBlk = prev[idx - 1];
      if (prevBlk.type === 'text') {
        const merged = { ...prevBlk, text: prevBlk.text + (prev[idx] as TextBlock).text };
        const next = [...prev.slice(0, idx - 1), merged, ...prev.slice(idx + 1)];
        const pos = prevBlk.text.length;
        setTimeout(() => {
          const el = taRefs.current.get(prevBlk.id);
          if (el) { el.focus(); el.setSelectionRange(pos, pos); }
        }, 0);
        return next;
      }
      return prev.filter(b => b.id !== prevBlk.id);
    });
    scheduleSave();
  }, [scheduleSave]);

  // ── File upload ─────────────────────────────────────────────────────────────

  const handleFiles = useCallback(async (files: File[]) => {
    for (const file of files) {
      const task = uploadFile(file, pct => setUploadPct(pct));
      try {
        const r = await task.promise;
        setUploadPct(null);
        const blk: NoteBlock = r.type === 'image'
          ? { id: uid(), type: 'image', url: r.url, name: r.name, size: r.size }
          : r.type === 'video'
          ? { id: uid(), type: 'video', url: r.url, name: r.name, size: r.size }
          : { id: uid(), type: 'file',  url: r.url, name: r.name, size: r.size };
        insertBlock(blk);
      } catch { setUploadPct(null); }
    }
  }, [insertBlock]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length) handleFiles(files);
    e.target.value = '';
  }, [handleFiles]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files);
    if (files.length) { e.preventDefault(); handleFiles(files); }
  }, [handleFiles]);

  // ── Emoji / Sticker / GIF ───────────────────────────────────────────────────

  const insertEmoji = useCallback((emoji: string) => {
    const curId = activeId.current;
    setBlocks(prev => {
      if (curId) {
        return prev.map(b => {
          if (b.id !== curId || b.type !== 'text') return b;
          const pos = activeCursor.current;
          const text = b.text.slice(0, pos) + emoji + b.text.slice(pos);
          return { ...b, text };
        });
      }
      // No focused block — append to last text block
      const lastTxt = [...prev].reverse().find(b => b.type === 'text');
      if (!lastTxt) return prev;
      return prev.map(b => b.id === lastTxt.id && b.type === 'text'
        ? { ...b, text: b.text + emoji } : b);
    });
    activeCursor.current += emoji.length;
    setTimeout(() => {
      if (curId) {
        const el = taRefs.current.get(curId);
        const p = activeCursor.current;
        el?.setSelectionRange(p, p);
      }
    }, 0);
    scheduleSave();
  }, [scheduleSave]);

  const handleSendGif     = (url: string) => { insertBlock({ id: uid(), type: 'gif', url }); setShowEmoji(false); };
  const handleSendSticker = (url: string, itemId: string, packId: string) => { insertBlock({ id: uid(), type: 'sticker', url, packId, itemId }); setShowEmoji(false); };
  const handleCustomEmoji = (packId: string, itemId: string, fileUrl: string) => { insertBlock({ id: uid(), type: 'sticker', url: fileUrl, packId, itemId }); setShowEmoji(false); };

  // ── Delete note ─────────────────────────────────────────────────────────────

  const myRole = chat.members.find(m => m.id === meId)?.role ?? 'member';
  const canDelete = chat.type === 'group' ? myRole === 'admin' || myRole === 'moderator' : true;

  async function handleDelete() {
    try { await deleteNote(chat.id, note.id); onDelete(note.id); } catch { /* ignore */ }
  }

  const editorName = note.last_edited_by_name ?? null;

  return (
    <div className="notesEditor" onPaste={handlePaste}>

      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="notesEditorHeader">
        <button className="notesBackBtn" onClick={onBack} title="К списку заметок">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <div className="notesEditorMeta">
          {saving
            ? <span className="notesSaving">Сохранение…</span>
            : <span className="notesSavedAt">
                {relTime(savedAt)}
                {editorName && <span className="notesSavedBy"> · {editorName}</span>}
              </span>
          }
        </div>
        {canDelete && (
          <button className="notesDeleteBtn" onClick={() => setConfirmDel(true)} title="Удалить заметку">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
              <path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
            </svg>
          </button>
        )}
      </div>

      {/* ── Title ───────────────────────────────────────────────────── */}
      <input
        className="notesEditorTitle"
        value={title}
        onChange={e => { setTitle(e.target.value); scheduleSave(); }}
        placeholder="Заголовок"
        maxLength={200}
      />

      {/* ── Upload progress ──────────────────────────────────────────── */}
      {uploadPct !== null && <UploadBar pct={uploadPct} />}

      {/* ── Block list ──────────────────────────────────────────────── */}
      <div className="notesContent">
        {blocks.map((blk, i) => {
          if (blk.type === 'text') {
            return (
              <textarea
                key={blk.id}
                ref={el => { if (el) taRefs.current.set(blk.id, el); else taRefs.current.delete(blk.id); }}
                className="notesTextBlock"
                value={blk.text}
                placeholder={i === 0 ? 'Начните писать…' : ''}
                rows={1}
                maxLength={50000}
                onChange={e => {
                  updateText(blk.id, e.target.value);
                  e.target.style.height = 'auto';
                  e.target.style.height = e.target.scrollHeight + 'px';
                }}
                onFocus={e => { activeId.current = blk.id; activeCursor.current = e.target.selectionStart; }}
                onSelect={e => { activeCursor.current = (e.target as HTMLTextAreaElement).selectionStart; }}
                onKeyDown={e => { activeCursor.current = (e.target as HTMLTextAreaElement).selectionStart; handleTextKeyDown(e, blk.id); }}
                onKeyUp={e => { activeCursor.current = (e.target as HTMLTextAreaElement).selectionStart; }}
                onClick={e => { activeId.current = blk.id; activeCursor.current = (e.target as HTMLTextAreaElement).selectionStart; }}
              />
            );
          }
          return (
            <MediaBlock
              key={blk.id}
              block={blk}
              onDelete={() => deleteBlock(blk.id)}
            />
          );
        })}
      </div>

      {/* ── Bottom toolbar ───────────────────────────────────────────── */}
      <div className="notesToolbar">
        <input
          ref={fileRef}
          type="file"
          accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,.xls,.xlsx,.txt,.zip,.rar,.7z"
          multiple
          style={{ display: 'none' }}
          onChange={handleFileInput}
        />
        <button
          className="notesToolbarBtn"
          onClick={() => fileRef.current?.click()}
          disabled={uploadPct !== null}
          title="Прикрепить файл или медиа"
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
          </svg>
        </button>

        <div className="notesEmojiWrap">
          <button
            ref={emojiBtnRef}
            className={`notesToolbarBtn${showEmoji ? ' ntbActive' : ''}`}
            onClick={() => setShowEmoji(v => !v)}
            title="Emoji, стикеры, GIF"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <path d="M8 14s1.5 2 4 2 4-2 4-2"/>
              <line x1="9" y1="9" x2="9.01" y2="9" strokeWidth="3"/>
              <line x1="15" y1="9" x2="15.01" y2="9" strokeWidth="3"/>
            </svg>
          </button>

          {showEmoji && (
            <div ref={emojiRef} className="notesEmojiPanel">
              <Suspense fallback={<div className="notesEmojiLoader">Загрузка…</div>}>
                <EmojiStickerPanel
                  onEmojiSelect={(e: { native: string }) => insertEmoji(e.native)}
                  onSendGif={handleSendGif}
                  onSendSticker={handleSendSticker}
                  onSendCustomEmoji={handleCustomEmoji}
                  onOpenStudio={() => {}}
                  theme={theme ?? 'dark'}
                />
              </Suspense>
            </div>
          )}
        </div>
      </div>

      {/* ── Delete confirm ──────────────────────────────────────────── */}
      {confirmDel && createPortal(
        <div className="notesConfirmOverlay" onClick={() => setConfirmDel(false)}>
          <div className="notesConfirmCard" onClick={e => e.stopPropagation()}>
            <div className="notesConfirmTitle">Удалить заметку?</div>
            <div className="notesConfirmSub">Это действие нельзя отменить.</div>
            <div className="notesConfirmActions">
              <button className="notesConfirmCancel" onClick={() => setConfirmDel(false)}>Отмена</button>
              <button className="notesConfirmOk" onClick={handleDelete}>Удалить</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

// ─── Note list item ───────────────────────────────────────────────────────────

function snippet(content: string): string {
  if (!content) return 'Пусто';
  try {
    const blocks = JSON.parse(content) as NoteBlock[];
    const text = blocks.find(b => b.type === 'text') as TextBlock | undefined;
    const plain = (text?.text ?? '').replace(/\n+/g, ' ').trim();
    return plain.slice(0, 80) || (blocks.length > 1 ? '📎 Вложение' : 'Пусто');
  } catch {
    return content.replace(/\n+/g, ' ').slice(0, 80);
  }
}

// ─── Stable empty array (prevents Zustand selector from returning new ref each render) ──

const EMPTY_NOTES: SharedNote[] = [];

// ─── Main panel ───────────────────────────────────────────────────────────────

interface Props { chat: Chat; onClose: () => void; }

export function NotesPanel({ chat, onClose }: Props) {
  const meId       = useSessionStore(s => s.me!.id);
  const notesRaw   = useNotesStore(s => s.notesByChatId[chat.id]);
  const notes      = notesRaw ?? EMPTY_NOTES;
  const loading    = useNotesStore(s => s.loadingByChatId[chat.id] ?? false);
  const loadNotes  = useNotesStore(s => s.loadNotes);
  const upsertNote = useNotesStore(s => s.upsertNote);
  const removeNote = useNotesStore(s => s.removeNote);

  const [editing, setEditing]   = useState<SharedNote | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => { loadNotes(chat.id); }, [chat.id, loadNotes]);

  // Sync socket updates into the open editor (remote edits only)
  const editingRef = useRef(editing);
  useEffect(() => { editingRef.current = editing; }, [editing]);
  useEffect(() => {
    if (!editingRef.current) return;
    const fresh = notes.find(n => n.id === editingRef.current!.id);
    if (
      fresh &&
      fresh.last_edited_by !== meId &&
      fresh.last_edited_at > editingRef.current!.last_edited_at
    ) {
      setEditing(fresh);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, meId]);

  async function handleCreate() {
    if (creating) return;
    setCreating(true);
    try {
      const note = await createNote(chat.id);
      upsertNote(chat.id, note);
      setEditing(note);
    } catch { /* ignore */ }
    setCreating(false);
  }

  function handleDeleted(noteId: string) {
    removeNote(chat.id, noteId);
    setEditing(null);
  }

  // ── Editing view — panel header is hidden, editor takes full space ────────
  if (editing) {
    return (
      <div className="notesPanel">
        <NoteEditor
          key={editing.id}
          note={editing}
          chat={chat}
          meId={meId}
          onBack={() => setEditing(null)}
          onDelete={handleDeleted}
        />
      </div>
    );
  }

  // ── List view ─────────────────────────────────────────────────────────────
  return (
    <div className="notesPanel">
      <div className="notesPanelHeader">
        <div className="notesPanelTitle">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
          </svg>
          Заметки
        </div>
        <button className="notesNewBtn" onClick={handleCreate} disabled={creating} title="Новая заметка">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Новая
        </button>
        <button className="notesPanelClose" onClick={onClose} title="Закрыть">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <div className="notesList">
        {loading && notes.length === 0 && (
          <div className="notesEmpty"><span className="notesSpin" /></div>
        )}
        {!loading && notes.length === 0 && (
          <div className="notesEmpty">
            <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" className="notesEmptyIcon">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
            </svg>
            <div className="notesEmptyText">Нет заметок</div>
            <div className="notesEmptySub">Нажмите «Новая», чтобы создать первую</div>
          </div>
        )}
        {notes.map(note => (
          <button key={note.id} className="notesItem" onClick={() => setEditing(note)}>
            <div className="notesItemTop">
              <span className="notesItemTitle">{note.title || 'Без названия'}</span>
              <span className="notesItemTime">{relTime(note.last_edited_at)}</span>
            </div>
            <div className="notesItemSnippet">{snippet(note.content)}</div>
            {note.last_edited_by_name && (
              <div className="notesItemEditor">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                </svg>
                {note.last_edited_by_name}
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
