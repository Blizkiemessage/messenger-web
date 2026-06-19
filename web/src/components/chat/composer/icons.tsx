/**
 * composer/icons.tsx — small presentational icons/badges used by the Composer.
 */
import { getFileCategory } from './helpers';

export function FileIconBadge({ name, size = 44 }: { name: string; size?: number }) {
  const { color, label } = getFileCategory(name);
  const fontSize = label.length > 3 ? size * 0.22 : size * 0.26;
  return (
    <div className="fileIconBadge" style={{ width: size, height: size, background: color + '22', borderColor: color + '55' }}>
      <svg width={size * 0.52} height={size * 0.52} viewBox="0 0 24 24" fill="none">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" fill={color + '33'} stroke={color} strokeWidth="1.6" strokeLinecap="round"/>
        <polyline points="14 2 14 8 20 8" stroke={color} strokeWidth="1.6" strokeLinecap="round"/>
      </svg>
      <span className="fileIconLabel" style={{ color, fontSize }}>{label}</span>
    </div>
  );
}

// ── Waveform icon SVG (replaces mic icon) ─────────────────────────────────────
export function WaveformIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <rect x="1"  y="9"  width="2.5" height="6"  rx="1.2"/>
      <rect x="5"  y="5"  width="2.5" height="14" rx="1.2"/>
      <rect x="9"  y="2"  width="2.5" height="20" rx="1.2"/>
      <rect x="13" y="5"  width="2.5" height="14" rx="1.2"/>
      <rect x="17" y="7"  width="2.5" height="10" rx="1.2"/>
      <rect x="21" y="9"  width="2.5" height="6"  rx="1.2"/>
    </svg>
  );
}

// ── Video note icon (camera circle) ───────────────────────────────────────────
export function VideoNoteIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <polygon points="10 8 16 12 10 16 10 8" fill="currentColor" stroke="none"/>
    </svg>
  );
}
