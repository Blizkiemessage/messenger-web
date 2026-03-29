import axios from 'axios';
import { API_BASE_URL } from '../config';
import { getSession } from '../storage/session';

const client = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
});

client.interceptors.request.use((config) => {
  const session = getSession();
  if (session?.token) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${session.token}`;
  }
  return config;
});

client.interceptors.response.use(
  (r) => r,
  (err) => {
    const status = err?.response?.status;
    const message =
      err?.response?.data?.error ||
      err?.response?.data?.message ||
      err?.message ||
      'Request failed';
    const error = Object.assign(new Error(message), { status });
    // Force logout on auth errors so they never surface as visible UI text
    if (status === 401 || status === 403) {
      import('../store/useSessionStore').then(({ useSessionStore }) => {
        useSessionStore.getState().clearSession();
      });
    }
    return Promise.reject(error);
  },
);

export default client;

