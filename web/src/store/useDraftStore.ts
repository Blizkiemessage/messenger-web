import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface DraftState {
  drafts: Record<string, string>; // chatId → draft text
  setDraft:   (chatId: string, text: string) => void;
  clearDraft: (chatId: string) => void;
}

export const useDraftStore = create<DraftState>()(
  persist(
    (set) => ({
      drafts: {},
      setDraft: (chatId, text) =>
        set(s => ({ drafts: { ...s.drafts, [chatId]: text } })),
      clearDraft: (chatId) =>
        set(s => {
          const next = { ...s.drafts };
          delete next[chatId];
          return { drafts: next };
        }),
    }),
    { name: 'blizkie-drafts' }
  )
);
