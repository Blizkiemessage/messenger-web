/**
<<<<<<< HEAD
 * useAppStore
 *
 * UI-only state that needs to be shared across the component tree:
 *   - theme (dark / light)
 *   - modal visibility flags
 *   - context menu position
 *
 * Components read their own visibility flag and close themselves — no
 * need to pass onClose callbacks through the tree.
 */

=======
 * useAppStore — UI-only shared state (theme, modals, menus).
 * Accent colour is now managed in useSessionStore (per-user).
 */
>>>>>>> devDK
import { create } from 'zustand';
import { type Chat } from '../types';
import { type Theme, getStoredTheme, applyTheme } from '../utils/theme';

interface AppState {
  theme: Theme;
<<<<<<< HEAD

  // Profile panel (sidebar pop-up)
  showProfile: boolean;

  // Full modals
=======
  showProfile: boolean;
>>>>>>> devDK
  showProfileSettings: boolean;
  showCreateGroup: boolean;
  showGroupInfo: boolean;
  showDeleteConfirm: boolean;
<<<<<<< HEAD

  // User profile viewer
  viewUserId: string | null;

  // Chat context menu (right-click on a chat in sidebar)
  chatCtxMenu: { x: number; y: number; chat: Chat } | null;

  // Leave / delete chat confirmation
  chatActionConfirm: Chat | null;
  chatActionBusy: boolean;

  // Delete messages confirmation
  deleteBusy: boolean;

  // ── Actions ──────────────────────────────────────────────────────────────
  toggleTheme: () => void;

  toggleProfile: () => void;
  setShowProfile: (v: boolean) => void;

=======
  viewUserId: string | null;
  chatCtxMenu: { x: number; y: number; chat: Chat } | null;
  chatActionConfirm: Chat | null;
  chatActionBusy: boolean;
  deleteBusy: boolean;

  toggleTheme: () => void;
  toggleProfile: () => void;
  setShowProfile: (v: boolean) => void;
>>>>>>> devDK
  setShowProfileSettings: (v: boolean) => void;
  setShowCreateGroup: (v: boolean) => void;
  setShowGroupInfo: (v: boolean) => void;
  setShowDeleteConfirm: (v: boolean) => void;
<<<<<<< HEAD

  setViewUserId: (id: string | null) => void;

=======
  setViewUserId: (id: string | null) => void;
>>>>>>> devDK
  setChatCtxMenu: (m: { x: number; y: number; chat: Chat } | null) => void;
  setChatActionConfirm: (chat: Chat | null) => void;
  setChatActionBusy: (v: boolean) => void;
  setDeleteBusy: (v: boolean) => void;
}

const initialTheme = getStoredTheme();
applyTheme(initialTheme);

export const useAppStore = create<AppState>((set) => ({
  theme: initialTheme,
<<<<<<< HEAD

=======
>>>>>>> devDK
  showProfile: false,
  showProfileSettings: false,
  showCreateGroup: false,
  showGroupInfo: false,
  showDeleteConfirm: false,
<<<<<<< HEAD

=======
>>>>>>> devDK
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

  toggleProfile: () => set(state => ({ showProfile: !state.showProfile })),
  setShowProfile: (showProfile) => set({ showProfile }),
<<<<<<< HEAD

  setShowProfileSettings: (showProfileSettings) => set({ showProfileSettings }),
  setShowCreateGroup: (showCreateGroup) => set({ showCreateGroup }),
  setShowGroupInfo: (showGroupInfo) => set({ showGroupInfo }),
  setShowDeleteConfirm: (showDeleteConfirm) => set({ showDeleteConfirm }),

  setViewUserId: (viewUserId) => set({ viewUserId }),

=======
  setShowProfileSettings: (v) => set({ showProfileSettings: v }),
  setShowCreateGroup: (v) => set({ showCreateGroup: v }),
  setShowGroupInfo: (v) => set({ showGroupInfo: v }),
  setShowDeleteConfirm: (v) => set({ showDeleteConfirm: v }),
  setViewUserId: (viewUserId) => set({ viewUserId }),
>>>>>>> devDK
  setChatCtxMenu: (chatCtxMenu) => set({ chatCtxMenu }),
  setChatActionConfirm: (chatActionConfirm) => set({ chatActionConfirm }),
  setChatActionBusy: (chatActionBusy) => set({ chatActionBusy }),
  setDeleteBusy: (deleteBusy) => set({ deleteBusy }),
}));
