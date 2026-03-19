export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.toString() || 'http://localhost:3000';

export const SOCKET_URL =
  import.meta.env.VITE_SOCKET_URL?.toString() || API_BASE_URL;

