/**
 * StickerMedia — renders a sticker item correctly for any file type:
 *  • video/* (WebM/MP4 etc.) → <video autoPlay loop muted>
 *  • image/* (GIF/WebP/PNG etc.) → <img> with animated file_url,
 *    falls back to thumb_url if the main URL fails to load.
 *
 * All URLs are resolved through resolveUrl so /uploads/ paths get the
 * backend origin prepended automatically.
 */
import { resolveUrl } from './Avatar';

const VIDEO_RE = /\.(webm|mp4|mov|avi|mpeg|3gp)(\?|#|$)/i;

function isVideoUrl(url: string): boolean {
  return VIDEO_RE.test(url);
}

interface Props {
  fileUrl:  string;
  thumbUrl: string | null;
  alt?:     string;
  className?: string;
  loading?: 'lazy' | 'eager';
}

export function StickerMedia({ fileUrl, thumbUrl, alt = 'Стикер', className, loading = 'lazy' }: Props) {
  const src      = resolveUrl(fileUrl)  ?? fileUrl;
  const fallback = thumbUrl ? (resolveUrl(thumbUrl) ?? thumbUrl) : undefined;

  if (isVideoUrl(src)) {
    return (
      <video
        src={src}
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        className={className}
        style={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain' }}
      />
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      loading={loading}
      onError={e => {
        if (fallback && e.currentTarget.src !== fallback) {
          e.currentTarget.src = fallback;
        }
      }}
    />
  );
}
