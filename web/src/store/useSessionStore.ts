/**
 * useSessionStore
 *
 * Holds the authenticated user's token and profile.
 * Applies/resets the per-user accent colour on login/logout.
 */
import { create } from 'zustand';
import { type User } from '../types';
import { getSession, setSession as persistSession, clearSession as clearPersisted } from '../storage/session';
import { onUserLogin, onUserLogout } from '../utils/accent';

interface SessionState {
  token: string | null;
  me: User | null;
  accent: string;

  setSession: (token: string, me: User) => void;
  clearSession: () => void;
  updateMe: (user: User) => void;
}

const saved = getSession();
// Apply saved user's accent immediately on startup (before React renders)
const initialAccent = saved?.user?.id ? onUserLogin(saved.user.id) : '#2f81f7';

export const useSessionStore = create<SessionState>((set) => ({
  token: saved?.token ?? null,
  me: saved?.user ?? null,
  accent: initialAccent,

  setSession: (token, me) => {
    persistSession({ token, user: me });
    const accent = onUserLogin(me.id);   // load + apply this user's colour
    set({ token, me, accent });
  },

  clearSession: () => {
    clearPersisted();
    onUserLogout();                       // reset CSS to default blue
    set({ token: null, me: null, accent: '#2f81f7' });
  },

  updateMe: (me) => {
    set(state => {
      if (state.token) persistSession({ token: state.token, user: me });
      return { me };
    });
  },
}));
