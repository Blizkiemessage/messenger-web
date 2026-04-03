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

// Client-side video compression via MediaRecorder.
// Re-encodes the video at lower bitrate (1 Mbps video + 128 kbps audio → ~8x smaller than typical phone video).
// Falls back to original file if browser doesn't support the codec.
async function compressVideo(file: File): Promise<{ blob: Blob; mime: string }> {
  const supported = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
    ? 'video/webm;codecs=vp9,opus'
    : MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
    ? 'video/webm;codecs=vp8,opus'
    : null;

  if (!supported) return { blob: file, mime: file.type };

  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.src = URL.createObjectURL(file);

    video.onloadedmetadata = () => {
      const canvas = document.createElement('canvas');
      // Limit to 720p to save space
      const MAX = 1280;
      let { videoWidth: w, videoHeight: h } = video;
      if (w > MAX || h > MAX) {
        const r = Math.min(MAX / w, MAX / h);
        w = Math.round(w * r);
        h = Math.round(h * r);
      }
      canvas.width  = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;

      const stream = canvas.captureStream(30);
      // Add audio track from original video if available
      const audioCtx = new AudioContext();
      const src = audioCtx.createMediaElementSource(video);
      const dst = audioCtx.createMediaStreamDestination();
      src.connect(dst);
      for (const track of dst.stream.getAudioTracks()) stream.addTrack(track);

      const recorder = new MediaRecorder(stream, {
        mimeType: supported,
        videoBitsPerSecond: 1_000_000,   // 1 Mbps
        audioBitsPerSecond: 128_000,
      });
      const chunks: Blob[] = [];
      recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = () => {
        URL.revokeObjectURL(video.src);
        audioCtx.close();
        const blob = new Blob(chunks, { type: 'video/webm' });
        // Only use compressed version if it's actually smaller
        resolve(blob.size < file.size ? { blob, mime: 'video/webm' } : { blob: file, mime: file.type });
      };

      recorder.start(100);
      video.play();

      const drawFrame = () => {
        if (video.ended || video.paused) { recorder.stop(); return; }
        ctx.drawImage(video, 0, 0, w, h);
        requestAnimationFrame(drawFrame);
      };
      video.onplay = () => requestAnimationFrame(drawFrame);
      video.onended = () => recorder.stop();
    };

    video.onerror = () => resolve({ blob: file, mime: file.type });
  });
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
    // Determine what mime we'll actually upload (WebP for images, WebM for videos)
    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');
    const compressibleImage = isImage && file.type !== 'image/gif' && file.type !== 'image/svg+xml';
    const uploadMime = compressibleImage ? 'image/webp' : isVideo ? 'video/webm' : file.type;

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
    const { uploadUrl, fileUrl, contentDisposition } = presignRes.data as { uploadUrl: string; fileUrl: string; contentType: string; contentDisposition: string };
    let blob: Blob = file;
    let mime = file.type;

    if (isImage) {
      const compressed = await compressImage(file);
      blob = compressed.blob;
      mime = compressed.mime;
    } else if (isVideo) {
      const compressed = await compressVideo(file);
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
        else reject(new Error(`Ошибка загрузки (${xhr.status})`));
      };
      xhr.onerror = () => reject(new Error('Ошибка сети при загрузке файла. Проверьте CORS в настройках бакета.'));
      xhr.open('PUT', uploadUrl);
      xhr.setRequestHeader('Content-Type', mime);
      if (contentDisposition) xhr.setRequestHeader('Content-Disposition', contentDisposition);
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
