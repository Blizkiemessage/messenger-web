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
import i18n from '../../i18n';

const VIDEO_RE = /\.(webm|mp4|mov|avi|mpeg|3gp)(\?|#|$)/i;
/** GIF, APNG and animated WebP must be loaded eagerly; lazy loading inside
 *  overflow-scroll containers prevents the Intersection Observer from
 *  triggering, so these images never decode/animate.
 *  Note: all three formats are stored by the backend after GIF→WebP compression. */
const ANIM_RE  = /\.(gif|apng|webp)(\?|#|$)/i;

function isVideoUrl(url: string): boolean {
  return VIDEO_RE.test(url);
}

function isAnimatedImage(url: string): boolean {
  return ANIM_RE.test(url);
}

interface Props {
  fileUrl:  string;
  thumbUrl: string | null;
  alt?:     string;
  className?: string;
  loading?: 'lazy' | 'eager';
}

export function StickerMedia({ fileUrl, thumbUrl, alt, className, loading = 'eager' }: Props) {
  const resolvedAlt = alt ?? i18n.t('chat:sticker.altText');
  const src      = resolveUrl(fileUrl)  ?? fileUrl;
  const fallback = thumbUrl ? (resolveUrl(thumbUrl) ?? thumbUrl) : undefined;
  // Animated images (GIF/APNG) must always be loaded eagerly — inside overflow-scroll
  // containers the browser's Intersection Observer uses the document viewport, not the
  // scroll container, so lazy items are never detected as visible and never animate.
  const effectiveLoading: 'eager' | 'lazy' = isAnimatedImage(src) ? 'eager' : loading;

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
      alt={resolvedAlt}
      className={className}
      loading={effectiveLoading}
      onError={e => {
        if (fallback && e.currentTarget.src !== fallback) {
          e.currentTarget.src = fallback;
        }
      }}
    />
  );
}
