import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface DraftState {
  drafts: Record<string, string>; // chatId → draft text
  setDraft:   (chatId: string, text: string) => void;
  clearDraft: (chatId: string) => void;
  /** Wipes all drafts — called on logout so unsent text doesn't linger in
   *  localStorage on a shared/family device after the account signs out. */
  clearAllDrafts: () => void;
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
      clearAllDrafts: () => set({ drafts: {} }),
    }),
    { name: 'blizkie-drafts' }
  )
);
