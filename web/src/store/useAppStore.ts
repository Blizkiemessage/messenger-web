/**
 * useAppStore — UI-only shared state.
 * Initialises theme AND accent colour from localStorage on startup.
 */
import { create } from 'zustand';
import { type Chat } from '../types';
import { type Theme, getStoredTheme, applyTheme } from '../utils/theme';
import { getStoredAccent, applyAccent } from '../utils/accent';

interface AppState {
  theme: Theme;
  accent: string;

  showProfile: boolean;
  showProfileSettings: boolean;
  showCreateGroup: boolean;
  showGroupInfo: boolean;
  showDeleteConfirm: boolean;
  viewUserId: string | null;
  chatCtxMenu: { x: number; y: number; chat: Chat } | null;
  chatActionConfirm: Chat | null;
  chatActionBusy: boolean;
  deleteBusy: boolean;

  toggleTheme: () => void;
  setAccent: (hex: string) => void;
  toggleProfile: () => void;
  setShowProfile: (v: boolean) => void;
  setShowProfileSettings: (v: boolean) => void;
  setShowCreateGroup: (v: boolean) => void;
  setShowGroupInfo: (v: boolean) => void;
  setShowDeleteConfirm: (v: boolean) => void;
  setViewUserId: (id: string | null) => void;
  setChatCtxMenu: (m: { x: number; y: number; chat: Chat } | null) => void;
  setChatActionConfirm: (chat: Chat | null) => void;
  setChatActionBusy: (v: boolean) => void;
  setDeleteBusy: (v: boolean) => void;
}

const initialTheme = getStoredTheme();
applyTheme(initialTheme);

const initialAccent = getStoredAccent();
applyAccent(initialAccent);

export const useAppStore = create<AppState>((set) => ({
  theme: initialTheme,
  accent: initialAccent,

  showProfile: false,
  showProfileSettings: false,
  showCreateGroup: false,
  showGroupInfo: false,
  showDeleteConfirm: false,
  viewUserId: null,
  chatCtxMenu: null,
  chatActionConfirm: null,
  chatActionBusy: false,
  deleteBusy: false,

  toggleTheme: () => set(state => {
    const next: Theme = state.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    return { theme: next };
  }),

  setAccent: (hex) => { applyAccent(hex); set({ accent: hex }); },

  toggleProfile: () => set(state => ({ showProfile: !state.showProfile })),
  setShowProfile: (showProfile) => set({ showProfile }),
  setShowProfileSettings: (v) => set({ showProfileSettings: v }),
  setShowCreateGroup: (v) => set({ showCreateGroup: v }),
  setShowGroupInfo: (v) => set({ showGroupInfo: v }),
  setShowDeleteConfirm: (v) => set({ showDeleteConfirm: v }),
  setViewUserId: (viewUserId) => set({ viewUserId }),
  setChatCtxMenu: (chatCtxMenu) => set({ chatCtxMenu }),
  setChatActionConfirm: (chatActionConfirm) => set({ chatActionConfirm }),
  setChatActionBusy: (chatActionBusy) => set({ chatActionBusy }),
  setDeleteBusy: (deleteBusy) => set({ deleteBusy }),
}));
