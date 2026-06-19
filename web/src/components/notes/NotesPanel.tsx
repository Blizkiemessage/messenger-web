/**
 * NotesPanel — F4 v2: Shared notes with permissions, read/edit mode, settings.
 *
 * Orchestrator: shows the note list, creates notes, and switches into the
 * editor. Pieces live in sibling files:
 *   types        — note block model
 *   helpers      — uid / parse / serialize / relTime / snippet / canEdit …
 *   MediaBlocks  — FileIcon, Lightbox, NoteVideoBlock, MediaBlock, UploadBar
 *   NoteSettings — per-note edit/visibility permissions
 *   NoteEditor   — the rich block editor (read + edit modes)
 */
import { useState, useEffect, useRef } from 'react';
import type { SharedNote, Chat } from '../../types';
import { useNotesStore } from '../../store/useNotesStore';
import { useSessionStore } from '../../store/useSessionStore';
import { createNote } from '../../api/notes';
import { relTime, snippet } from './helpers';
import { NoteEditor } from './NoteEditor';

// ─── Stable empty array — prevents Zustand selector returning new ref each render ──
const EMPTY_NOTES: SharedNote[] = [];

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

  // Sync remote note updates into open editor
  const editingRef = useRef(editing);
  useEffect(() => { editingRef.current = editing; }, [editing]);
  useEffect(() => {
    if (!editingRef.current) return;
    const fresh = notes.find(n => n.id === editingRef.current!.id);
    if (fresh && fresh.last_edited_by !== meId && fresh.last_edited_at > editingRef.current!.last_edited_at) {
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

  // ── Editor view ───────────────────────────────────────────────────────────
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
          onNoteUpdated={updated => setEditing(updated)}
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
