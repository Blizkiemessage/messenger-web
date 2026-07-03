import { type User } from '../types';
import { useDraftStore } from '../store/useDraftStore';

const KEY         = 'blizkie.user.v1';
const LEGACY_KEY  = 'blizkie.session.v1';
const LEGACY_TOKEN_KEY = 'blizkie.token.v1'; // access token used to live here — now purged
const REFRESH_KEY = 'blizkie.refresh.v1';
const LAST_CHAT_KEY = 'blz.lastChat'; // mirrors useChatsStore.ts — not imported to avoid a store↔store cycle

/**
 * Public session data stored in localStorage.
 * sessionId (jti) is the UUID of the DB session row — not a secret.
 *
 * ── Token storage model (security: keep the access token out of JS-readable storage) ──
 *   • Access token  → IN-MEMORY ONLY (module variable below). Never persisted, so an
 *     XSS payload cannot read a ready-to-use bearer token from localStorage. It is
 *     primarily carried by the HttpOnly `session` cookie anyway; the in-memory copy is
 *     the cross-origin fallback (Vercel→Amvera) when Chrome/Safari block that cookie.
 *   • Refresh token → localStorage. Kept persistent because the HttpOnly `refresh`
 *     cookie can be blocked as a third-party cookie cross-origin, and we must survive a
 *     full page reload. It is scoped (only used at /auth/refresh), single-use and
 *     rotated with replay detection, so its blast radius is far smaller than the
 *     access token's.
 */
export type Session = { user: User; sessionId: string | null };

// In-memory access token — lives only for the lifetime of this tab/page.
let accessToken: string | null = null;

// One-time hygiene: purge any access token persisted by older app versions.
try { localStorage.removeItem(LEGACY_TOKEN_KEY); } catch { /* ignore */ }

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
  accessToken = null;
  localStorage.removeItem(KEY);
  localStorage.removeItem(LEGACY_TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(LEGACY_KEY); // clean up old key if present
  localStorage.removeItem(LAST_CHAT_KEY);
  // Unsent draft text is per-account and must not survive on a shared device
  // after logout — every logout path (manual, 401, revoked session,
  // account-deleted) funnels through this single function.
  try { useDraftStore.getState().clearAllDrafts(); } catch { /* store not ready yet */ }
}

/** Store the access token in memory (NOT localStorage). */
export function saveToken(token: string): void {
  accessToken = token;
}

/** Read the in-memory access token (null after a fresh reload until refreshed). */
export function getToken(): string | null {
  return accessToken;
}

/** Store refresh token so axios interceptor can send it as a cross-origin fallback. */
export function saveRefreshToken(token: string): void {
  localStorage.setItem(REFRESH_KEY, token);
}

/** Read stored refresh token (null if not present or cookie-based auth). */
export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY);
}
