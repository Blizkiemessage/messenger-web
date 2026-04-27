import axios from 'axios';
import { API_BASE_URL } from '../config';
import { getToken } from '../storage/session';

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

client.interceptors.response.use(
  (r) => r,
  (err) => {
    const status = err?.response?.status;
    const message =
      err?.response?.data?.error ||
      err?.response?.data?.message ||
      err?.message ||
      'Request failed';
    return Promise.reject(Object.assign(new Error(message), { status }));
  },
);

export default client;
