import { type UserCreationQuota } from '../../../types';
import { TRIM_MAX_DURATION } from '../VideoTrimmerModal';

export const MAX_ITEMS = 100;
export const MAX_SECONDS = TRIM_MAX_DURATION;

// Accepted formats: all raster, vector, animated and video
export const ACCEPT_TYPES = [
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.apng',
  '.bmp', '.tiff', '.tif', '.avif', '.heic', '.svg',
  '.mp4', '.webm', '.mov', '.avi', '.mpeg',
  'image/*', 'video/*',
].join(',');

export function formatQuota(q: UserCreationQuota) {
  return `${q.packs_created} / ${q.free_packs_limit + q.extra_packs}`;
}

/** Get video duration in seconds via a hidden video element */
export function getVideoDuration(file: File): Promise<number> {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(v.duration); };
    v.onerror = () => { URL.revokeObjectURL(url); resolve(0); };
    v.src = url;
  });
}

/** Parse GIF duration from binary (centiseconds → seconds) */
export function parseGifDuration(buffer: ArrayBuffer): number {
  const b = new Uint8Array(buffer);
  let totalCs = 0;
  const hasGct = !!(b[10] & 0x80);
  const gctSize = hasGct ? 3 * (1 << ((b[10] & 0x07) + 1)) : 0;
  let i = 13 + gctSize;
  while (i < b.length) {
    const s = b[i];
    if (s === 0x3b || s === undefined) break;
    if (s === 0x21) {
      const label = b[i + 1];
      if (label === 0xf9) {
        totalCs += b[i + 4] | (b[i + 5] << 8);
        i += 8; continue;
      }
      i += 2;
      let sub = b[i++]; while (sub > 0) { i += sub; sub = b[i++]; }
    } else if (s === 0x2c) {
      i += 10;
      const hasLct = !!(b[i - 1] & 0x80);
      if (hasLct) i += 3 * (1 << ((b[i - 1] & 0x07) + 1));
      i++; let sub = b[i++]; while (sub > 0) { i += sub; sub = b[i++]; }
    } else { i++; }
  }
  return totalCs / 100;
}
