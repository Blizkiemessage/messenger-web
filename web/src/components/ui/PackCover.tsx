/**
 * PackCover — renders a sticker-pack logo/cover.
 * Handles image, animated GIF/WebP, and short video covers.
 * Falls back to the first letter of the pack name.
 */
import { resolveUrl } from './Avatar';

const VIDEO_RE = /\.(webm|mp4|mov|avi|mpeg|3gp)(\?|#|$)/i;

interface Props {
  url:  string | null;
  name: string;
  /** Extra class to apply to the video/img element */
  className?: string;
}

export function PackCover({ url, name, className }: Props) {
  if (!url) {
    return <span className="packCoverFallback">{name[0]}</span>;
  }

  const src = resolveUrl(url) ?? url;

  if (VIDEO_RE.test(src)) {
    return (
      <video
        src={src}
        autoPlay
        loop
        muted
        playsInline
        className={className}
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
      />
    );
  }

  return (
    <img
      src={src}
      alt={name}
      className={className}
      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
    />
  );
}
