/**
 * api/upload.ts
 * ✅ FIXED: No manual Content-Type header — axios sets multipart/form-data
 *   with correct boundary automatically when passed FormData.
 *   Without this, multer on the server may fail to detect MIME type correctly.
 */
import client from './client';

export interface UploadResult {
  url: string;
  type: 'image' | 'video' | 'file';
  name: string;
  size: number;
}

export async function uploadFile(
  file: File,
  onProgress: (pct: number) => void,
): Promise<UploadResult> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await client.post<UploadResult>('/upload', formData, {
    // ✅ Do NOT set Content-Type manually.
    // Axios auto-sets: "Content-Type: multipart/form-data; boundary=----..."
    // Setting it manually drops the boundary → multer can't parse the body.
    timeout: 120_000,
    onUploadProgress: (e) => {
      if (e.total && e.total > 0) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    },
  });

  return {
    ...response.data,
    size: response.data.size ?? file.size,
  };
}
