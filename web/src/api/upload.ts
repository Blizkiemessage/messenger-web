/**
 * api/upload.ts
 * File upload with real-time progress tracking via XMLHttpRequest.
 */
import { getSession } from '../storage/session';
import { API_BASE_URL } from '../config';

export interface UploadResult {
  url: string;
  type: 'image' | 'video' | 'file';
  name: string;
  size: number;
}

/**
 * Upload a file to the server with progress reporting.
 * @param file        The File object to upload
 * @param onProgress  Callback called with 0–100 percentage during upload
 * @returns           Resolved UploadResult on success
 */
export function uploadFile(
  file: File,
  onProgress: (pct: number) => void,
): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const session  = getSession();
    const formData = new FormData();
    formData.append('file', file);

    const xhr = new XMLHttpRequest();

    // Upload progress
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    });

    // Success
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText) as UploadResult;
          // Fallback: use File.size if backend didn't return size
          resolve({ ...data, size: data.size ?? file.size });
        } catch {
          reject(new Error('Неверный ответ от сервера'));
        }
      } else {
        try {
          const err = JSON.parse(xhr.responseText);
          reject(new Error(err.error || `Ошибка загрузки: ${xhr.status}`));
        } catch {
          reject(new Error(`Ошибка загрузки: ${xhr.status}`));
        }
      }
    });

    xhr.addEventListener('error', () => reject(new Error('Ошибка сети при загрузке файла')));
    xhr.addEventListener('abort', () => reject(new Error('Загрузка отменена')));

    xhr.open('POST', `${API_BASE_URL}/upload`);
    if (session?.token) {
      xhr.setRequestHeader('Authorization', `Bearer ${session.token}`);
    }
    xhr.send(formData);
  });
}
