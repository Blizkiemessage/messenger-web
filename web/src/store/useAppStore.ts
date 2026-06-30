/**
 * useAppStore — UI-only shared state (theme, modals, menus).
 * Accent colour is now managed in useSessionStore (per-user).
 */
import { create } from 'zustand';
import { type Chat } from '../types';
import { type Theme, getStoredTheme, applyTheme } from '../utils/theme';
import { getSession } from '../storage/session';

/** Активная вкладка нижнего меню на мобильном (десктоп его не использует). */
export type MobileTab = 'chats' | 'calls' | 'search';

/** Активная вкладка боковой панели навигации на десктопе (поиск живёт в списке). */
export type DesktopTab = 'chats' | 'calls';

/** Секция правой панели информации о чате, к которой нужно прокрутить/раскрыть. */
export type InfoPanelSection = 'profile' | 'customize' | 'media' | null;

/** Стартовое состояние правой панели: открыта по умолчанию на широких экранах. */
const initialInfoPanelOpen = typeof window !== 'undefined'
  ? (window.localStorage.getItem('blz.infoPanel') ?? (window.innerWidth >= 1180 ? '1' : '0')) === '1'
  : false;

interface AppState {
  theme: Theme;
  /** Какая вкладка нижнего меню открыта на мобильном. */
  mobileTab: MobileTab;
  /** Какая вкладка боковой панели навигации открыта на десктопе. */
  desktopTab: DesktopTab;
  /** Открыта ли правая панель информации о чате (десктоп). */
  showInfoPanel: boolean;
  /** Какую секцию правой панели раскрыть при открытии (из шапки чата). */
  infoPanelSection: InfoPanelSection;
  showProfile: boolean;
  showProfileSettings: boolean;
  showCreateGroup: boolean;
  showGroupInfo: boolean;
  showDeleteConfirm: boolean;
  showInvite: boolean;
  showAssistant: boolean;
  showSupport: boolean;
  viewUserId: string | null;
  chatCtxMenu: { x: number; y: number; chat: Chat } | null;
  chatActionConfirm: Chat | null;
  chatActionBusy: boolean;
  deleteBusy: boolean;
  deleteForEveryone: boolean;   // true = delete for all, false = delete for me only

  // ✅ Forward state
  forwardingIds: string[] | null;   // message IDs queued for forwarding (null = not in forward mode)
  showForwardModal: boolean;

  toggleTheme: () => void;
  setMobileTab: (t: MobileTab) => void;
  setDesktopTab: (t: DesktopTab) => void;
  setShowInfoPanel: (v: boolean) => void;
  toggleInfoPanel: () => void;
  setInfoPanelSection: (s: InfoPanelSection) => void;
  toggleProfile: () => void;
  setShowProfile: (v: boolean) => void;
  setShowProfileSettings: (v: boolean) => void;
  setShowCreateGroup: (v: boolean) => void;
  setShowGroupInfo: (v: boolean) => void;
  setShowDeleteConfirm: (v: boolean) => void;
  setShowInvite: (v: boolean) => void;
  setShowAssistant: (v: boolean) => void;
  setShowSupport: (v: boolean) => void;
  setViewUserId: (id: string | null) => void;
  setChatCtxMenu: (m: { x: number; y: number; chat: Chat } | null) => void;
  setChatActionConfirm: (chat: Chat | null) => void;
  setChatActionBusy: (v: boolean) => void;
  setDeleteBusy: (v: boolean) => void;
  setDeleteForEveryone: (v: boolean) => void;
  setForwardingIds: (ids: string[] | null) => void;
  setShowForwardModal: (v: boolean) => void;
}

// Prefer theme saved in the session user object (synced from backend) over localStorage
const _savedSession = getSession();
const initialTheme: Theme = (_savedSession?.user?.theme as Theme) || getStoredTheme();
applyTheme(initialTheme);

export const useAppStore = create<AppState>((set) => ({
  theme: initialTheme,
  mobileTab: 'chats',
  desktopTab: 'chats',
  showInfoPanel: initialInfoPanelOpen,
  infoPanelSection: null,
  showProfile: false,
  showProfileSettings: false,
  showCreateGroup: false,
  showGroupInfo: false,
  showDeleteConfirm: false,
  showInvite: false,
  showAssistant: false,
  showSupport: false,
  viewUserId: null,
  chatCtxMenu: null,
  chatActionConfirm: null,
  chatActionBusy: false,
  deleteBusy: false,
  deleteForEveryone: true,
  forwardingIds: null,
  showForwardModal: false,

  toggleTheme: () => set(state => {
    const next: Theme = state.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    return { theme: next };
  }),

  setMobileTab: (mobileTab) => set({ mobileTab }),
  setDesktopTab: (desktopTab) => set({ desktopTab }),
  setShowInfoPanel: (showInfoPanel) => {
    try { window.localStorage.setItem('blz.infoPanel', showInfoPanel ? '1' : '0'); } catch { /* ignore */ }
    set({ showInfoPanel });
  },
  toggleInfoPanel: () => set(state => {
    const next = !state.showInfoPanel;
    try { window.localStorage.setItem('blz.infoPanel', next ? '1' : '0'); } catch { /* ignore */ }
    return { showInfoPanel: next };
  }),
  setInfoPanelSection: (infoPanelSection) => set({ infoPanelSection }),
  toggleProfile: () => set(state => ({ showProfile: !state.showProfile })),
  setShowProfile: (showProfile) => set({ showProfile }),
  setShowProfileSettings: (v) => set({ showProfileSettings: v }),
  setShowCreateGroup: (v) => set({ showCreateGroup: v }),
  setShowGroupInfo: (v) => set({ showGroupInfo: v }),
  setShowDeleteConfirm: (v) => set({ showDeleteConfirm: v }),
  setShowInvite: (v) => set({ showInvite: v }),
  setShowAssistant: (v) => set({ showAssistant: v }),
  setShowSupport: (v) => set({ showSupport: v }),
  setViewUserId: (viewUserId) => set({ viewUserId }),
  setChatCtxMenu: (chatCtxMenu) => set({ chatCtxMenu }),
  setChatActionConfirm: (chatActionConfirm) => set({ chatActionConfirm }),
  setChatActionBusy: (chatActionBusy) => set({ chatActionBusy }),
  setDeleteBusy: (deleteBusy) => set({ deleteBusy }),
  setDeleteForEveryone: (deleteForEveryone) => set({ deleteForEveryone }),
  setForwardingIds: (forwardingIds) => set({ forwardingIds }),
  setShowForwardModal: (showForwardModal) => set({ showForwardModal }),
}));
