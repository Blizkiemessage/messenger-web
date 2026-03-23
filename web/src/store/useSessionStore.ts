/**
 * useSessionStore
 *
 * Holds the authenticated user's token and profile.
<<<<<<< HEAD
 * Initialized from localStorage on first load via getSession().
 *
 * Used by: AuthScreen (write), App (read), useSocket (read), any component
 * that needs to know who is logged in.
 */

import { create } from 'zustand';
import { type User } from '../types';
import { getSession, setSession as persistSession, clearSession as clearPersisted } from '../storage/session';
=======
 * Applies/resets the per-user accent colour on login/logout.
 */
import { create } from 'zustand';
import { type User } from '../types';
import { getSession, setSession as persistSession, clearSession as clearPersisted } from '../storage/session';
import { onUserLogin, onUserLogout } from '../utils/accent';
>>>>>>> devDK

interface SessionState {
  token: string | null;
  me: User | null;
<<<<<<< HEAD

  /** Called after successful login or registration */
  setSession: (token: string, me: User) => void;

  /** Called on logout or account deletion */
  clearSession: () => void;

  /** Called after profile update (PATCH /users/me) */
=======
  accent: string;

  setSession: (token: string, me: User) => void;
  clearSession: () => void;
>>>>>>> devDK
  updateMe: (user: User) => void;
}

const saved = getSession();
<<<<<<< HEAD
=======
// Apply saved user's accent immediately on startup (before React renders)
const initialAccent = saved?.user?.id ? onUserLogin(saved.user.id) : '#2f81f7';
>>>>>>> devDK

export const useSessionStore = create<SessionState>((set) => ({
  token: saved?.token ?? null,
  me: saved?.user ?? null,
<<<<<<< HEAD

  setSession: (token, me) => {
    persistSession({ token, user: me });
    set({ token, me });
=======
  accent: initialAccent,

  setSession: (token, me) => {
    persistSession({ token, user: me });
    const accent = onUserLogin(me.id);   // load + apply this user's colour
    set({ token, me, accent });
>>>>>>> devDK
  },

  clearSession: () => {
    clearPersisted();
<<<<<<< HEAD
    set({ token: null, me: null });
=======
    onUserLogout();                       // reset CSS to default blue
    set({ token: null, me: null, accent: '#2f81f7' });
>>>>>>> devDK
  },

  updateMe: (me) => {
    set(state => {
      if (state.token) persistSession({ token: state.token, user: me });
      return { me };
    });
  },
}));
