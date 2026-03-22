// ✅ .replace(/\/+$/, '') strips trailing slash(es) from the env variable.
// Without this: API_BASE_URL = "https://railway.app/" and resolveUrl builds
// "https://railway.app/" + "/uploads/file.jpg" = "https://railway.app//uploads/file.jpg"
// Railway's Express static middleware can't match the double-slash path → 404.
export const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL?.toString() || 'http://localhost:3000')
    .replace(/\/+$/, '');

export const SOCKET_URL =
  (import.meta.env.VITE_SOCKET_URL?.toString() || API_BASE_URL)
    .replace(/\/+$/, '');
