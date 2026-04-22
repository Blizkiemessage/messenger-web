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
import { onUserLogin, onUserLogout, applyAccentCss, saveUserAccent } from '../utils/accent';
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
// Apply saved user's accent immediately on startup (before React renders)
const initialAccent = saved?.user?.id ? onUserLogin(saved.user.id) : '#2f81f7';

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
    set({ me, sessionId, accent });
  },

  clearSession: () => {
    clearPersisted();
    onUserLogout();                        // reset CSS to default blue
    set({ me: null, sessionId: null, accent: '#2f81f7' });
  },

  updateMe: (me) => {
    set(state => {
      persistSession({ user: me, sessionId: state.sessionId });
      return { me };
    });
  },
}));
