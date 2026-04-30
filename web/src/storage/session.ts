import { type User } from '../types';

const KEY         = 'blizkie.user.v1';
const LEGACY_KEY  = 'blizkie.session.v1';
const TOKEN_KEY   = 'blizkie.token.v1';
const REFRESH_KEY = 'blizkie.refresh.v1';

/**
 * Public session data stored in localStorage.
 * sessionId (jti) is the UUID of the DB session row — not a secret.
 *
 * JWT is also stored here (TOKEN_KEY) so cross-origin deployments
 * (Vercel → Amvera) can send it via Authorization: Bearer header,
 * bypassing Chrome's third-party cookie blocking (Privacy Sandbox).
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
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(LEGACY_KEY); // clean up old key if present
}

/** Store JWT so axios interceptor and socketClient can send it as Bearer token. */
export function saveToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

/** Read stored JWT (may be null if cookie-only auth or not yet stored). */
export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

/** Store refresh token for cross-origin clients (Vercel → Amvera). */
export function saveRefreshToken(token: string): void {
  localStorage.setItem(REFRESH_KEY, token);
}

/** Read stored refresh token (null if not present or cookie-based auth). */
export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY);
}
