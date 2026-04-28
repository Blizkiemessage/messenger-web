/**
 * NotesPanel — F4: Shared notes for a chat.
 *
 * Two views:
 *   - List: all notes for the chat with a "New note" button
 *   - Editor: title input + content textarea, auto-saved via debounce
 *
 * Deletion rules:
 *   - group chat: admin / moderator only
 *   - direct / saved: any member
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { SharedNote } from '../../types';
import type { Chat } from '../../types';
import { useNotesStore } from '../../store/useNotesStore';
import { createNote, updateNote, deleteNote } from '../../api/notes';
import { useSessionStore } from '../../store/useSessionStore';

const AUTOSAVE_DELAY = 800;

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'только что';
  if (minutes < 60) return `${minutes} мин. назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч. назад`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} дн. назад`;
  return new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

function snippet(content: string, maxLen = 80): string {
  const text = content.replace(/\n+/g, ' ').trim();
  return text.length > maxLen ? text.slice(0, maxLen) + '…' : text || 'Пусто';
}

interface EditorProps {
  note: SharedNote;
  chat: Chat;
  meId: string;
  onBack: () => void;
  onDelete: (noteId: string) => void;
}

function NoteEditor({ note, chat, meId, onBack, onDelete }: EditorProps) {
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState(note.last_edited_at);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<{ title: string; content: string } | null>(null);
  const upsertNote = useNotesStore(s => s.upsertNote);

  // Determine if user can delete
  const myMember = chat.members.find(m => m.id === meId);
  const myRole = myMember?.role ?? 'member';
  const canDelete = chat.type === 'group'
    ? (myRole === 'admin' || myRole === 'moderator')
    : true;

  const scheduleSave = useCallback((newTitle: string, newContent: string) => {
    pendingRef.current = { title: newTitle, content: newContent };
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const payload = pendingRef.current;
      if (!payload) return;
      pendingRef.current = null;
      setSaving(true);
      try {
        const updated = await updateNote(chat.id, note.id, payload);
        upsertNote(chat.id, updated);
        setLastSaved(updated.last_edited_at);
      } catch { /* silently ignore — will retry on next change */ }
      setSaving(false);
    }, AUTOSAVE_DELAY);
  }, [chat.id, note.id, upsertNote]);

  // Flush on unmount
  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        const payload = pendingRef.current;
        if (payload) {
          updateNote(chat.id, note.id, payload)
            .then(updated => upsertNote(chat.id, updated))
            .catch(() => {});
        }
      }
    };
  }, [chat.id, note.id, upsertNote]);

  function handleTitleChange(val: string) {
    setTitle(val);
    scheduleSave(val, content);
  }

  function handleContentChange(val: string) {
    setContent(val);
    scheduleSave(title, val);
  }

  async function handleDelete() {
    try {
      await deleteNote(chat.id, note.id);
      onDelete(note.id);
    } catch { /* ignore */ }
  }

  const editorName = note.last_edited_by_name || null;

  return (
    <div className="notesEditor">
      <div className="notesEditorHeader">
        <button className="notesBackBtn" onClick={onBack} title="Назад">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <div className="notesEditorMeta">
          {saving
            ? <span className="notesSaving">Сохранение…</span>
            : <span className="notesSavedAt">
                Сохранено {formatRelativeTime(lastSaved)}
                {editorName && <span className="notesSavedBy"> · {editorName}</span>}
              </span>
          }
        </div>
        {canDelete && (
          <button
            className="notesDeleteBtn"
            onClick={() => setConfirmDelete(true)}
            title="Удалить заметку"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
              <path d="M10 11v6M14 11v6"/>
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
            </svg>
          </button>
        )}
      </div>

      <input
        className="notesEditorTitle"
        value={title}
        onChange={e => handleTitleChange(e.target.value)}
        placeholder="Заголовок"
        maxLength={200}
      />

      <textarea
        className="notesEditorContent"
        value={content}
        onChange={e => handleContentChange(e.target.value)}
        placeholder="Начните писать…"
        maxLength={50000}
      />

      {confirmDelete && createPortal(
        <div className="notesConfirmOverlay" onClick={() => setConfirmDelete(false)}>
          <div className="notesConfirmCard" onClick={e => e.stopPropagation()}>
            <div className="notesConfirmTitle">Удалить заметку?</div>
            <div className="notesConfirmSub">Это действие нельзя отменить.</div>
            <div className="notesConfirmActions">
              <button className="notesConfirmCancel" onClick={() => setConfirmDelete(false)}>Отмена</button>
              <button className="notesConfirmOk" onClick={handleDelete}>Удалить</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

interface Props {
  chat: Chat;
  onClose: () => void;
}

export function NotesPanel({ chat, onClose }: Props) {
  const meId = useSessionStore(s => s.me!.id);
  const notes = useNotesStore(s => s.notesByChatId[chat.id] ?? []);
  const loading = useNotesStore(s => s.loadingByChatId[chat.id] ?? false);
  const loadNotes = useNotesStore(s => s.loadNotes);
  const upsertNote = useNotesStore(s => s.upsertNote);
  const removeNote = useNotesStore(s => s.removeNote);

  const [editingNote, setEditingNote] = useState<SharedNote | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    loadNotes(chat.id);
  }, [chat.id, loadNotes]);

  // If a note being edited gets updated from socket, keep local state in sync
  useEffect(() => {
    if (!editingNote) return;
    const fresh = notes.find(n => n.id === editingNote.id);
    if (fresh && fresh.last_edited_by !== meId && fresh.last_edited_at > editingNote.last_edited_at) {
      setEditingNote(fresh);
    }
  }, [notes, editingNote, meId]);

  async function handleCreateNote() {
    if (creating) return;
    setCreating(true);
    try {
      const note = await createNote(chat.id);
      upsertNote(chat.id, note);
      setEditingNote(note);
    } catch { /* ignore */ }
    setCreating(false);
  }

  function handleNoteDeleted(noteId: string) {
    removeNote(chat.id, noteId);
    setEditingNote(null);
  }

  return (
    <div className="notesPanel">
      {/* Header */}
      <div className="notesPanelHeader">
        {editingNote ? null : (
          <>
            <div className="notesPanelTitle">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
                <polyline points="10 9 9 9 8 9"/>
              </svg>
              Заметки
            </div>
            <button
              className="notesNewBtn"
              onClick={handleCreateNote}
              disabled={creating}
              title="Новая заметка"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              Новая
            </button>
          </>
        )}
        <button className="notesPanelClose" onClick={editingNote ? () => setEditingNote(null) : onClose} title={editingNote ? 'К списку' : 'Закрыть'}>
          {editingNote ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          )}
        </button>
      </div>

      {/* Body */}
      {editingNote ? (
        <NoteEditor
          note={editingNote}
          chat={chat}
          meId={meId}
          onBack={() => setEditingNote(null)}
          onDelete={handleNoteDeleted}
        />
      ) : (
        <div className="notesList">
          {loading && notes.length === 0 && (
            <div className="notesEmpty">
              <span className="notesSpin" />
            </div>
          )}
          {!loading && notes.length === 0 && (
            <div className="notesEmpty">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" className="notesEmptyIcon">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
                <polyline points="10 9 9 9 8 9"/>
              </svg>
              <div className="notesEmptyText">Нет заметок</div>
              <div className="notesEmptySub">Нажмите «Новая», чтобы создать первую</div>
            </div>
          )}
          {notes.map(note => (
            <button
              key={note.id}
              className="notesItem"
              onClick={() => setEditingNote(note)}
            >
              <div className="notesItemTop">
                <span className="notesItemTitle">{note.title || 'Без названия'}</span>
                <span className="notesItemTime">{formatRelativeTime(note.last_edited_at)}</span>
              </div>
              <div className="notesItemSnippet">{snippet(note.content)}</div>
              {note.last_edited_by_name && (
                <div className="notesItemEditor">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                  </svg>
                  {note.last_edited_by_name}
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
