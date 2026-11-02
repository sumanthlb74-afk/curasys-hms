import axios from 'axios';
import { getApiErrorMessage } from './api-error-message.js';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  headers: { 'Content-Type': 'application/json' },
  timeout: 90_000,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('curasys_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && !error.config?.url?.endsWith('/auth/login')) {
      localStorage.removeItem('curasys_token');
      window.dispatchEvent(new Event('curasys:session-expired'));
    }
    return Promise.reject(new Error(getApiErrorMessage(error)));
  },
);

export default api;
