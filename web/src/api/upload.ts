/**
 * api/upload.ts
 * ✅ FIXED: pass `headers: { 'Content-Type': undefined }` to override the
 *   axios client's default `application/json` so axios can auto-set
 *   `multipart/form-data; boundary=...` from the FormData object.
 *   Without this multer receives the wrong Content-Type and req.file is undefined.
 */
import client from './client';

export interface UploadResult {
  url:  string;
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
    headers:  { 'Content-Type': undefined }, // ← let axios detect boundary from FormData
    timeout:  120_000,
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
