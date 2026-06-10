/**
 * useSessionStore
 *
 * Holds the authenticated user profile and session ID.
 * JWT lives in an HttpOnly cookie — never in JS memory.
 * sessionId (jti UUID) is used only to identify which 'session-revoked' event is ours.
 */
import { create } from 'zustand';
import { type User } from '../types';
import { getSession, setSession as persistSession, clearSession as clearPersisted } from '../storage/session';
import { onUserLogin, onUserLogout, applyAccentCss, saveUserAccent, DEFAULT_ACCENT } from '../utils/accent';
import { onUserLoginBg, onUserLogoutBg, applyServerAppBg } from '../utils/appBackground';
import { applyTheme, type Theme } from '../utils/theme';
import { useAppStore } from './useAppStore';

interface SessionState {
  me: User | null;
  sessionId: string | null;
  accent: string;

  setSession: (me: User, sessionId: string | null) => void;
  clearSession: () => void;
  updateMe: (user: User) => void;
}

const saved = getSession();
// Apply saved user's accent and app background immediately on startup (before React renders)
const initialAccent = saved?.user?.id ? onUserLogin(saved.user.id) : DEFAULT_ACCENT;
if (saved?.user?.id) onUserLoginBg(saved.user.id);

export const useSessionStore = create<SessionState>((set) => ({
  me:        saved?.user      ?? null,
  sessionId: saved?.sessionId ?? null,
  accent:    initialAccent,

  setSession: (me, sessionId) => {
    persistSession({ user: me, sessionId });
    // Apply accent from server (overrides localStorage default)
    if (me.accent_color) {
      applyAccentCss(me.accent_color);
      saveUserAccent(me.id, me.accent_color);
    }
    // Apply theme from server and sync useAppStore state so the toggle button is correct
    if (me.theme) {
      applyTheme(me.theme as Theme);
      useAppStore.setState({ theme: me.theme as Theme });
    }
    const accent = me.accent_color || onUserLogin(me.id);
    // Фон с сервера имеет приоритет (синк между устройствами); иначе — локальный кэш
    if (me.app_bg !== undefined) applyServerAppBg(me.id, me.app_bg);
    else onUserLoginBg(me.id);
    set({ me, sessionId, accent });
  },

  clearSession: () => {
    clearPersisted();
    onUserLogout();                        // reset CSS to default accent
    onUserLogoutBg();                      // reset app background to default aurora
    set({ me: null, sessionId: null, accent: DEFAULT_ACCENT });
  },

  updateMe: (me) => {
    set(state => {
      persistSession({ user: me, sessionId: state.sessionId });
      return { me };
    });
  },
}));
