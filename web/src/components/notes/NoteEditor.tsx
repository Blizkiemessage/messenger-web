/**
 * notes/NoteEditor.tsx — rich block editor for a single note.
 * Read mode (default) renders a clean view; edit mode adds the block editor,
 * media upload, emoji/sticker/GIF panel and the delete-confirm dialog.
 */
import { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import type { SharedNote, Chat } from '../../types';
import { useNotesStore } from '../../store/useNotesStore';
import { useAppStore } from '../../store/useAppStore';
import { updateNote, deleteNote } from '../../api/notes';
import { uploadFile } from '../../api/upload';
import type { NoteBlock, TextBlock } from './types';
import { uid, parseBlocks, serialize, canEdit, relTime } from './helpers';
import { MediaBlock, UploadBar } from './MediaBlocks';
import { NoteSettings } from './NoteSettings';

const EmojiStickerPanel = lazy(() =>
  import('../chat/EmojiStickerPanel').then(m => ({ default: m.EmojiStickerPanel }))
);
const StickerStudioModal = lazy(() =>
  import('../modals/StickerStudioModal').then(m => ({ default: m.StickerStudioModal }))
);

interface EditorProps {
  note: SharedNote;
  chat: Chat;
  meId: string;
  onBack: () => void;
  onDelete: (noteId: string) => void;
  onNoteUpdated: (note: SharedNote) => void;
}

export function NoteEditor({ note, chat, meId, onBack, onDelete, onNoteUpdated }: EditorProps) {
  const theme      = useAppStore(s => s.theme);
  const upsertNote = useNotesStore(s => s.upsertNote);

  const userCanEdit  = canEdit(note, meId);
  const isAuthor     = !note.created_by || note.created_by === meId;

  const [readMode, setReadMode]     = useState(true);
  const [showSettings, setSettings] = useState(false);
  const [showStudio, setShowStudio] = useState(false);
  const [title, setTitle]           = useState(note.title);
  const [blocks, setBlocks]         = useState<NoteBlock[]>(() => parseBlocks(note.content));
  const [saving, setSaving]         = useState(false);
  const [savedAt, setSavedAt]       = useState(note.last_edited_at);
  const [confirmDel, setConfirmDel] = useState(false);
  const [showEmoji, setShowEmoji]   = useState(false);
  const [uploadPct, setUploadPct]   = useState<number | null>(null);

  const saveTimer    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendTitle    = useRef(title);
  const pendBlocks   = useRef(blocks);
  const activeId     = useRef<string | null>(null);
  const activeCursor = useRef<number>(0);
  const taRefs       = useRef<Map<string, HTMLTextAreaElement>>(new Map());
  const fileRef      = useRef<HTMLInputElement>(null);
  const emojiRef     = useRef<HTMLDivElement>(null);
  const emojiBtnRef  = useRef<HTMLButtonElement>(null);

  useEffect(() => { pendTitle.current  = title;  }, [title]);
  useEffect(() => { pendBlocks.current = blocks; }, [blocks]);

  // Sync incoming note updates (remote edits) into editor state
  useEffect(() => {
    if (readMode) {
      setTitle(note.title);
      setBlocks(parseBlocks(note.content));
      setSavedAt(note.last_edited_at);
    }
  }, [note, readMode]);

  const doSave = useCallback(async () => {
    setSaving(true);
    try {
      const updated = await updateNote(chat.id, note.id, {
        title: pendTitle.current,
        content: serialize(pendBlocks.current),
      });
      upsertNote(chat.id, updated);
      onNoteUpdated(updated);
      setSavedAt(updated.last_edited_at);
    } catch { /* silent */ }
    setSaving(false);
  }, [chat.id, note.id, upsertNote, onNoteUpdated]);

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(doSave, 800);
  }, [doSave]);

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

  // Auto-resize textareas
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

  const insertBlock = useCallback((newBlk: NoteBlock) => {
    setBlocks(prev => {
      const curId  = activeId.current;
      const curIdx = curId ? prev.findIndex(b => b.id === curId) : prev.length - 1;
      const curBlk = prev[curIdx];
      const afterId = uid();

      if (curBlk?.type === 'text') {
        const pos    = activeCursor.current;
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
        const merged  = { ...prevBlk, text: prevBlk.text + (prev[idx] as TextBlock).text };
        const next    = [...prev.slice(0, idx - 1), merged, ...prev.slice(idx + 1)];
        const pos     = prevBlk.text.length;
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
      setUploadPct(1); // show bar immediately
      const task = uploadFile(file, pct => setUploadPct(pct), { skipVideoCompress: true });
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
          const pos  = activeCursor.current;
          const text = b.text.slice(0, pos) + emoji + b.text.slice(pos);
          return { ...b, text };
        });
      }
      const lastTxt = [...prev].reverse().find(b => b.type === 'text');
      if (!lastTxt) return prev;
      return prev.map(b => b.id === lastTxt.id && b.type === 'text'
        ? { ...b, text: b.text + emoji } : b);
    });
    activeCursor.current += emoji.length;
    setTimeout(() => {
      if (curId) {
        const el = taRefs.current.get(curId);
        const p  = activeCursor.current;
        el?.setSelectionRange(p, p);
      }
    }, 0);
    scheduleSave();
  }, [scheduleSave]);

  const handleSendGif     = (url: string) => { insertBlock({ id: uid(), type: 'gif',     url }); setShowEmoji(false); };
  const handleSendSticker = (url: string, itemId: string, packId: string) => { insertBlock({ id: uid(), type: 'sticker', url, packId, itemId }); setShowEmoji(false); };
  const handleCustomEmoji = (_pId: string, _iId: string, fileUrl: string) => { insertBlock({ id: uid(), type: 'sticker', url: fileUrl }); setShowEmoji(false); };
  const handleOpenStudio  = () => { setShowEmoji(false); setShowStudio(true); };

  // ── Delete note ─────────────────────────────────────────────────────────────

  const myRole   = chat.members.find(m => m.id === meId)?.role ?? 'member';
  const canDelete = isAuthor
    || (chat.type !== 'group')
    || myRole === 'admin'
    || myRole === 'moderator';

  async function handleDelete() {
    try { await deleteNote(chat.id, note.id); onDelete(note.id); } catch { /* ignore */ }
  }

  // ── Settings saved ──────────────────────────────────────────────────────────

  function handleSettingsSaved(updated: SharedNote) {
    upsertNote(chat.id, updated);
    onNoteUpdated(updated);
  }

  // ── Settings view ───────────────────────────────────────────────────────────
  if (showSettings) {
    return (
      <NoteSettings
        note={note}
        chat={chat}
        meId={meId}
        onBack={() => setSettings(false)}
        onSaved={handleSettingsSaved}
      />
    );
  }

  const editorName = note.last_edited_by_name ?? null;

  return (
    <div className="notesEditor" onPaste={!readMode ? handlePaste : undefined}>

      {/* ── Header ── */}
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

        {/* Mode toggle — only if user can edit */}
        {userCanEdit && (
          <button
            className={`notesModeToggle${!readMode ? ' ntmEdit' : ''}`}
            onClick={() => setReadMode(v => !v)}
            title={readMode ? 'Перейти к редактированию' : 'Режим чтения'}
          >
            {readMode
              ? <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                  </svg>
                  <span>Редактировать</span>
                </>
              : <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                  <span>Просмотр</span>
                </>
            }
          </button>
        )}

        {/* Settings gear — author only */}
        {isAuthor && (
          <button className="notesSettingsBtn" onClick={() => setSettings(true)} title="Настройки заметки">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </button>
        )}

        {canDelete && (
          <button className="notesDeleteBtn" onClick={() => setConfirmDel(true)} title="Удалить заметку">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
              <path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
            </svg>
          </button>
        )}
      </div>

      {/* ── Title ── */}
      {readMode
        ? <div className="notesReadTitle">{title || 'Без названия'}</div>
        : <input
            className="notesEditorTitle"
            value={title}
            onChange={e => { setTitle(e.target.value); scheduleSave(); }}
            placeholder="Заголовок"
            maxLength={200}
          />
      }

      {/* ── Upload progress ── */}
      {uploadPct !== null && <UploadBar pct={uploadPct} />}

      {/* ── Block list ── */}
      <div className="notesContent">
        {blocks.map((blk, i) => {
          if (blk.type === 'text') {
            if (readMode) {
              return <div key={blk.id} className="notesTextBlockRead">{blk.text}</div>;
            }
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
                onFocus={e  => { activeId.current = blk.id; activeCursor.current = e.target.selectionStart; }}
                onSelect={e => { activeCursor.current = (e.target as HTMLTextAreaElement).selectionStart; }}
                onKeyDown={e => { activeCursor.current = (e.target as HTMLTextAreaElement).selectionStart; handleTextKeyDown(e, blk.id); }}
                onKeyUp={e  => { activeCursor.current = (e.target as HTMLTextAreaElement).selectionStart; }}
                onClick={e  => { activeId.current = blk.id; activeCursor.current = (e.target as HTMLTextAreaElement).selectionStart; }}
              />
            );
          }
          return (
            <MediaBlock
              key={blk.id}
              block={blk}
              onDelete={() => deleteBlock(blk.id)}
              readOnly={readMode}
            />
          );
        })}
      </div>

      {/* ── Bottom toolbar (edit mode only) ── */}
      {!readMode && (
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
                    onOpenStudio={handleOpenStudio}
                    theme={theme ?? 'dark'}
                  />
                </Suspense>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Sticker studio ── */}
      {showStudio && (
        <Suspense fallback={null}>
          <StickerStudioModal onClose={() => setShowStudio(false)} />
        </Suspense>
      )}

      {/* ── Delete confirm ── */}
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
