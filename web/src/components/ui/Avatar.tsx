/**
 * Avatar.tsx
 * ✅ Fixed: shows letter fallback when image fails to load.
 * ✅ F3: presenceStatus ring — thin colored glow around the avatar.
 *
 * Ring layer (presenceStatus) and online-dot layer are independent:
 *   - presenceStatus ring = colored box-shadow on the avatar itself
 *   - online dot = small circle positioned absolutely by the parent component
 * They never conflict and coexist perfectly.
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

/** Maps a presence status to its ring color. */
export const PRESENCE_COLORS: Record<'free' | 'busy' | 'dnd', string> = {
  free: '#22c55e',
  busy: '#f59e0b',
  dnd:  '#ef4444',
};

/** Maps a presence status to its human-readable Russian label. */
export const PRESENCE_LABELS: Record<'free' | 'busy' | 'dnd', string> = {
  free: 'Свободен',
  busy: 'Занят',
  dnd:  'Не беспокоить',
};

export const PRESENCE_EMOJI: Record<'free' | 'busy' | 'dnd', string> = {
  free: '🟢',
  busy: '🟡',
  dnd:  '🔴',
};

export function Avatar({
  user,
  size = 36,
  radius = 11,
  presenceStatus,
}: {
  user?: User | null;
  size?: number;
  radius?: number;
  /** F3: when set, renders a thin colored ring around the avatar. */
  presenceStatus?: 'free' | 'busy' | 'dnd' | null;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const src = resolveUrl(user?.avatar_url);
  const name = user?.display_name || user?.username || '?';

  // Ring is handled purely via CSS class + custom property — no inline boxShadow
  // so that @keyframes animations on the ring work correctly.
  const ringClass = presenceStatus ? ` presenceRing--${presenceStatus}` : '';
  const ringVar: React.CSSProperties = presenceStatus
    ? ({ '--presence-color': PRESENCE_COLORS[presenceStatus] } as React.CSSProperties)
    : {};

  const baseStyle: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: radius,
    flexShrink: 0,
    ...ringVar,
  };

  // Show letter fallback if no URL or image failed to load
  if (!src || imgFailed) {
    return (
      <div
        className={`presenceRingEl${ringClass}`}
        style={{
          ...baseStyle,
          background: 'var(--accent-dim)',
          color: 'var(--accent)',
          display: 'grid',
          placeItems: 'center',
          fontWeight: 700,
          fontSize: Math.round(size * 0.42),
          userSelect: 'none',
        }}
      >
        {avatarLetter(name)}
      </div>
    );
  }

  return (
    <img
      className={`presenceRingEl${ringClass}`}
      src={src}
      alt={name}
      style={{
        ...baseStyle,
        objectFit: 'cover',
        display: 'block',
      }}
      onError={() => setImgFailed(true)}
    />
  );
}
