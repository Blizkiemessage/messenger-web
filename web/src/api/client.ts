import axios from 'axios';
import { API_BASE_URL } from '../config';
import { getToken, saveToken, getRefreshToken, saveRefreshToken, clearSession } from '../storage/session';

const client = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  withCredentials: true, // send HttpOnly session cookie on every request (same-origin / Safari)
  headers: {
    'Content-Type': 'application/json',
  },
});

client.interceptors.request.use((config) => {
  // For FormData, remove the default application/json Content-Type so the browser
  // can set multipart/form-data with the correct boundary automatically.
  if (config.data instanceof FormData) {
    delete config.headers['Content-Type'];
  }

  // Attach Bearer token so cross-origin deployments (Vercel → Amvera) work even
  // when Chrome blocks the HttpOnly session cookie (Privacy Sandbox / incognito).
  // The backend authMiddleware accepts cookie OR Authorization header — whichever arrives first.
  const token = getToken();
  if (token) {
    config.headers['Authorization'] = `Bearer ${token}`;
  }

  return config;
});

// Whether a token refresh is already in flight — prevents multiple simultaneous refreshes.
let refreshPromise: Promise<string | null> | null = null;

async function tryRefreshToken(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;

  try {
    // Call refresh endpoint directly (not via client to avoid interceptor loop).
    // Backend uses refresh token rotation: returns a new refresh token on every call.
    const res = await axios.post<{ token: string; refreshToken?: string }>(
      `${API_BASE_URL}/auth/refresh`,
      { refreshToken },
      { withCredentials: true, timeout: 10000 },
    );
    const newAccessToken = res.data.token;
    saveToken(newAccessToken);

    // Save the rotated refresh token so the next silent refresh uses the new one.
    // The old refresh token is now revoked on the server — we must not use it again.
    if (res.data.refreshToken) {
      saveRefreshToken(res.data.refreshToken);
    }

    return newAccessToken;
  } catch {
    // Refresh token is invalid/expired/revoked — clear everything and force re-login.
    clearSession();
    // Hard redirect so the app re-initialises with no stale state.
    window.location.href = '/';
    return null;
  }
}

/**
 * Cross-tab single-flight refresh.
 *
 * The access token now lives in memory (per-tab), so every tab refreshes
 * independently on reload. Refresh tokens are single-use with replay detection
 * that revokes the whole session — if two tabs refresh concurrently and race on
 * the shared localStorage refresh token, the loser replays a revoked token and
 * the backend kills the session (logging everyone out). The Web Locks API
 * serialises refreshes across tabs so each reads an already-rotated token.
 * Falls back to a plain call where navigator.locks is unavailable.
 */
async function lockedRefresh(): Promise<string | null> {
  if (typeof navigator !== 'undefined' && navigator.locks?.request) {
    // await unwraps the nested promise (both at runtime and via TS Awaited<>).
    return await navigator.locks.request('blizkie-token-refresh', () => tryRefreshToken());
  }
  return tryRefreshToken();
}

/**
 * Обновить access-токен. Дедуплицировано внутри вкладки (общий refreshPromise)
 * и сериализовано между вкладками (Web Locks). Используется интерсептором ниже
 * и socketClient'ом перед/при провале WS-handshake. Возвращает новый токен или
 * null (нет refresh-токена / refresh провалился — tryRefreshToken сам чистит
 * сессию и редиректит на логин).
 */
export function refreshAccessToken(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = lockedRefresh().finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

client.interceptors.response.use(
  (r) => r,
  async (err) => {
    const status = err?.response?.status;
    const originalRequest = err?.config;

    // On 401: try to refresh the access token once, then retry the original request.
    // Skip if: already retried, or this IS the refresh request itself.
    if (
      status === 401 &&
      !originalRequest._retried &&
      originalRequest.url !== '/auth/refresh'
    ) {
      originalRequest._retried = true;

      // Deduplicated in-tab + serialised cross-tab (Web Locks) — see refreshAccessToken.
      const newToken = await refreshAccessToken();
      if (newToken) {
        originalRequest.headers['Authorization'] = `Bearer ${newToken}`;
        return client(originalRequest);
      }
    }

    const message =
      err?.response?.data?.error ||
      err?.response?.data?.message ||
      err?.message ||
      'Request failed';
    return Promise.reject(Object.assign(new Error(message), { status }));
  },
);

export { saveRefreshToken };
export default client;
