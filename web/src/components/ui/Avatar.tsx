/**
 * Avatar.tsx
 * ✅ Fixed: shows letter fallback when image fails to load (instead of hiding it).
 */
import { useState } from 'react';
import { type User } from '../../types';
import { avatarLetter } from '../../utils/format';
import { API_BASE_URL } from '../../config';

export function resolveUrl(url?: string | null): string | null {
  if (!url) return null;
  if (url.startsWith('/uploads/')) return `${API_BASE_URL}${url}`;
  return url;
}

export function Avatar({
  user,
  size = 36,
  radius = 11,
}: {
  user?: User | null;
  size?: number;
  radius?: number;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const src = resolveUrl(user?.avatar_url);
  const name = user?.display_name || user?.username || '?';

  const letterStyle: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: radius,
    background: 'var(--accent-dim)',
    color: 'var(--accent)',
    display: 'grid',
    placeItems: 'center',
    fontWeight: 700,
    fontSize: Math.round(size * 0.42),
    flexShrink: 0,
    userSelect: 'none',
  };

  // Show letter fallback if no URL or image failed to load
  if (!src || imgFailed) {
    return <div style={letterStyle}>{avatarLetter(name)}</div>;
  }

  return (
    <img
      src={src}
      alt={name}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        objectFit: 'cover',
        flexShrink: 0,
        display: 'block',
      }}
      onError={() => setImgFailed(true)}
    />
  );
}
