import { create } from 'zustand';
import type { SharedNote } from '../types';
import { getChatNotes } from '../api/notes';

interface NotesState {
  notesByChatId: Record<string, SharedNote[]>;
  loadingByChatId: Record<string, boolean>;

  loadNotes: (chatId: string) => Promise<void>;
  upsertNote: (chatId: string, note: SharedNote) => void;
  removeNote: (chatId: string, noteId: string) => void;
  clearChat: (chatId: string) => void;
}

export const useNotesStore = create<NotesState>((set, get) => ({
  notesByChatId: {},
  loadingByChatId: {},

  loadNotes: async (chatId) => {
    if (get().loadingByChatId[chatId]) return;
    set(s => ({ loadingByChatId: { ...s.loadingByChatId, [chatId]: true } }));
    try {
      const notes = await getChatNotes(chatId);
      set(s => ({
        notesByChatId: { ...s.notesByChatId, [chatId]: notes },
        loadingByChatId: { ...s.loadingByChatId, [chatId]: false },
      }));
    } catch {
      set(s => ({ loadingByChatId: { ...s.loadingByChatId, [chatId]: false } }));
    }
  },

  upsertNote: (chatId, note) => {
    set(s => {
      const existing = s.notesByChatId[chatId] ?? [];
      const idx = existing.findIndex(n => n.id === note.id);
      let updated: SharedNote[];
      if (idx >= 0) {
        updated = existing.map(n => n.id === note.id ? note : n);
      } else {
        updated = [note, ...existing];
      }
      return { notesByChatId: { ...s.notesByChatId, [chatId]: updated } };
    });
  },

  removeNote: (chatId, noteId) => {
    set(s => {
      const existing = s.notesByChatId[chatId] ?? [];
      return {
        notesByChatId: {
          ...s.notesByChatId,
          [chatId]: existing.filter(n => n.id !== noteId),
        },
      };
    });
  },

  clearChat: (chatId) => {
    set(s => {
      const nb = { ...s.notesByChatId };
      const lb = { ...s.loadingByChatId };
      delete nb[chatId];
      delete lb[chatId];
      return { notesByChatId: nb, loadingByChatId: lb };
    });
  },
}));
