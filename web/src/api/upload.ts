/**
 * api/upload.ts
 * ✅ Added: cancel() function returned alongside the promise.
 *    Call cancel() to abort mid-upload — triggers an 'Upload cancelled' error.
 */
import client from './client';

export interface UploadResult {
  url:  string;
  type: 'image' | 'video' | 'file';
  name: string;
  size: number;
}

export interface UploadTask {
  /** Resolves with UploadResult on success */
  promise: Promise<UploadResult>;
  /** Call this to abort the upload */
  cancel: () => void;
}

export function uploadFile(
  file: File,
  onProgress: (pct: number) => void,
): UploadTask {
  const controller = new AbortController();

  const promise = client.post<UploadResult>('/upload', (() => {
    const fd = new FormData();
    fd.append('file', file);
    return fd;
  })(), {
    headers:  { 'Content-Type': undefined },
    timeout:  120_000,
    signal:   controller.signal,
    onUploadProgress: (e) => {
      if (e.total && e.total > 0) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    },
  }).then(res => ({
    ...res.data,
    size: res.data.size ?? file.size,
  })).catch(err => {
    // Normalise cancellation error message
    if (controller.signal.aborted) {
      throw new Error('Загрузка отменена');
    }
    throw err;
  });

  return {
    promise,
    cancel: () => controller.abort(),
  };
}
