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
  const src = resolveUrl(user?.avatar_url);
  if (src) {
    return (
      <img
        src={src}
        alt={user?.display_name || user?.username || ''}
        style={{
          width: size,
          height: size,
          borderRadius: radius,
          objectFit: 'cover',
          flexShrink: 0,
          display: 'block',
        }}
        onError={e => {
          (e.target as HTMLImageElement).style.display = 'none';
        }}
      />
    );
  }
  const name = user?.display_name || user?.username || '?';
  return (
    <div
      style={{
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
      }}
    >
      {avatarLetter(name)}
    </div>
  );
}
