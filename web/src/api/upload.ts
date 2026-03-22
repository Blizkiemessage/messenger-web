/**
 * api/upload.ts
 * File upload with real-time progress tracking via axios onUploadProgress.
 * Uses the shared axios client (handles auth token + base URL automatically).
 */
import client from './client';

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
export async function uploadFile(
  file: File,
  onProgress: (pct: number) => void,
): Promise<UploadResult> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await client.post<UploadResult>('/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120_000, // 2 min — enough for large files
    onUploadProgress: (e) => {
      if (e.total && e.total > 0) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    },
  });

  return {
    ...response.data,
    // Fallback: use File.size if backend didn't return size
    size: response.data.size ?? file.size,
  };
}
