import { type User } from '../types';

const KEY = 'blizkie.user.v1';
const LEGACY_KEY = 'blizkie.session.v1';

/**
 * Public session data stored in localStorage.
 * JWT lives in an HttpOnly cookie — never stored here.
 * sessionId (jti) is the UUID of the DB session row — not a secret.
 */
export type Session = { user: User; sessionId: string | null };

export function getSession(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.user?.id) return null;
    return parsed as Session;
  } catch {
    return null;
  }
}

export function setSession(session: Session): void {
  localStorage.setItem(KEY, JSON.stringify(session));
}

export function clearSession(): void {
  localStorage.removeItem(KEY);
  localStorage.removeItem(LEGACY_KEY); // clean up old key if present
}
