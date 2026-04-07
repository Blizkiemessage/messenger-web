import axios from 'axios';
import { API_BASE_URL } from '../config';
import { getSession } from '../storage/session';

const client = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
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
  // For FormData, remove the default application/json Content-Type so the browser
  // can set multipart/form-data with the correct boundary automatically.
  if (config.data instanceof FormData) {
    delete config.headers['Content-Type'];
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

