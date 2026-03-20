/**
 * useSessionStore
 *
 * Holds the authenticated user's token and profile.
 * Initialized from localStorage on first load via getSession().
 *
 * Used by: AuthScreen (write), App (read), useSocket (read), any component
 * that needs to know who is logged in.
 */

import { create } from 'zustand';
import { type User } from '../types';
import { getSession, setSession as persistSession, clearSession as clearPersisted } from '../storage/session';

interface SessionState {
  token: string | null;
  me: User | null;

  /** Called after successful login or registration */
  setSession: (token: string, me: User) => void;

  /** Called on logout or account deletion */
  clearSession: () => void;

  /** Called after profile update (PATCH /users/me) */
  updateMe: (user: User) => void;
}

const saved = getSession();

export const useSessionStore = create<SessionState>((set) => ({
  token: saved?.token ?? null,
  me: saved?.user ?? null,

  setSession: (token, me) => {
    persistSession({ token, user: me });
    set({ token, me });
  },

  clearSession: () => {
    clearPersisted();
    set({ token: null, me: null });
  },

  updateMe: (me) => {
    set(state => {
      if (state.token) persistSession({ token: state.token, user: me });
      return { me };
    });
  },
}));
