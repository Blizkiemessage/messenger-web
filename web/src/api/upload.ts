/**
 * api/upload.ts
 *
 * Upload flow:
 *   1. POST /upload/presign — get a presigned S3 PUT URL (S3 mode)
 *   2. Compress image client-side (Canvas → WebP, max 2560px, quality 0.82) — matches server sharp settings
 *   3. PUT directly to S3 via XHR (supports progress + cancel)
 *
 * Fallback: if server is in local disk mode (no S3), /upload/presign returns { fallback: true }
 * and the old multipart POST /upload flow is used instead.
 */
import client from './client';

export interface UploadResult {
  url:  string;
  type: 'image' | 'video' | 'audio' | 'file';
  name: string;
  size: number;
}

export interface UploadTask {
  promise: Promise<UploadResult>;
  cancel: () => void;
}

// Client-side image compression — mirrors server sharp logic:
// GIF and SVG pass through unchanged; everything else → WebP, quality 0.82, max 2560px.
async function compressImage(file: File): Promise<{ blob: Blob; mime: string }> {
  if (file.type === 'image/gif' || file.type === 'image/svg+xml') {
    return { blob: file, mime: file.type };
  }
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const MAX = 2560;
      let { width, height } = img;
      if (width > MAX || height > MAX) {
        const ratio = Math.min(MAX / width, MAX / height);
        width  = Math.round(width  * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width  = width;
      canvas.height = height;
      canvas.getContext('2d')!.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        blob => resolve({ blob: blob ?? file, mime: 'image/webp' }),
        'image/webp',
        0.82,
      );
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => resolve({ blob: file, mime: file.type });
    img.src = URL.createObjectURL(file);
  });
}

export function uploadFile(
  file: File,
  onProgress: (pct: number) => void,
): UploadTask {
  const controller = new AbortController();

  const promise = (async (): Promise<UploadResult> => {
    // Determine what mime we'll actually upload (WebP for compressible images)
    const isImage = file.type.startsWith('image/');
    const uploadMime = (isImage && file.type !== 'image/gif' && file.type !== 'image/svg+xml')
      ? 'image/webp'
      : file.type;

    // 1. Ask backend for a presigned URL
    const presignRes = await client.post<{ fallback: true } | { uploadUrl: string; fileUrl: string }>(
      '/upload/presign',
      { mime: uploadMime, size: file.size, filename: file.name },
    );

    // 2a. Fallback: server in local disk mode — use old multipart upload
    if ('fallback' in presignRes.data) {
      const fd = new FormData();
      fd.append('file', file);
      const r = await client.post<UploadResult>('/upload', fd, {
        headers: { 'Content-Type': undefined },
        timeout: 120_000,
        signal: controller.signal,
        onUploadProgress: e => { if (e.total) onProgress(Math.round(e.loaded / e.total * 100)); },
      });
      return { ...r.data, size: r.data.size ?? file.size };
    }

    // 2b. Presigned: compress image client-side, then PUT directly to S3
    const { uploadUrl, fileUrl } = presignRes.data;
    let blob: Blob = file;
    let mime = file.type;

    if (isImage) {
      const compressed = await compressImage(file);
      blob = compressed.blob;
      mime = compressed.mime;
    }

    if (controller.signal.aborted) throw new Error('Загрузка отменена');

    // PUT to S3 via XHR (fetch API doesn't support upload progress)
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      controller.signal.addEventListener('abort', () => {
        xhr.abort();
        reject(new Error('Загрузка отменена'));
      });
      xhr.upload.onprogress = e => { if (e.total) onProgress(Math.round(e.loaded / e.total * 100)); };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error(`S3 upload error ${xhr.status}`));
      };
      xhr.onerror = () => reject(new Error('Upload failed'));
      xhr.open('PUT', uploadUrl);
      xhr.setRequestHeader('Content-Type', mime);
      xhr.send(blob);
    });

    const type: UploadResult['type'] = mime.startsWith('image/') ? 'image'
      : mime.startsWith('video/') ? 'video'
      : mime.startsWith('audio/') ? 'audio'
      : 'file';

    return { url: fileUrl, type, name: file.name, size: blob.size };
  })().catch(err => {
    if (controller.signal.aborted) throw new Error('Загрузка отменена');
    throw err;
  });

  return { promise, cancel: () => controller.abort() };
}
